import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { BANKS } from "../lib/banks.js";
import { DELIVERY_METHODS, getStoreSettings } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { productInclude, serializeProduct } from "../services/catalog.js";

function likePattern(value: string) {
  return `%${value.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
}

async function smartPage(
  q: { category?: string; q?: string; page: number },
  pageSize: number,
) {
  const filters = [Prisma.sql`p."isActive" = true`];
  if (q.category) filters.push(Prisma.sql`c.slug = ${q.category} AND c."isActive" = true`);
  const pattern = q.q ? likePattern(q.q) : "";
  if (q.q) {
    filters.push(Prisma.sql`(p.title ILIKE ${pattern} ESCAPE '\\' OR p.description ILIKE ${pattern} ESCAPE '\\')`);
  }
  const where = Prisma.join(filters, " AND ");
  const titleRank = q.q ? Prisma.sql`CASE WHEN p.title ILIKE ${pattern} ESCAPE '\\' THEN 0 ELSE 1 END` : Prisma.sql`0`;
  const inStock = Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductVariant" v
    WHERE v."productId" = p.id AND v."isActive" = true AND v.stock > 0
  )`;
  const offset = (q.page - 1) * pageSize;
  const [ids, counted] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE ${where}
      ORDER BY ${inStock} DESC, ${titleRank}, p."createdAt" DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE ${where}`,
  ]);
  const rows = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids.map((row) => row.id) } }, include: productInclude })
    : [];
  const order = new Map(ids.map((row, index) => [row.id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { items: rows, total: counted[0]?.total ?? 0 };
}

export default async function catalogRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => {
    const store = await getStoreSettings();
    return {
      storeName: store.storeName,
      botUsername: config.TELEGRAM_BOT_USERNAME,
      supportTelegram: store.supportTelegram,
      supportEmail: store.supportEmail,
      pickupAddress: store.pickupAddress,
      delivery: DELIVERY_METHODS.filter((m) => store.deliveryEnabled[m]).map((m) => ({
        method: m,
        price: store.deliveryPrices[m],
      })),
      theme: { accentLight: store.accentLight, accentDark: store.accentDark, bgLight: store.bgLight, bgDark: store.bgDark },
      addressSuggest: Boolean(config.DADATA_API_KEY),
      banks: BANKS,
    };
  });

  app.get("/api/categories", async () => {
    const categories = await prisma.category.findMany({
      where: { isActive: true, products: { some: { isActive: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true },
    });
    return { categories };
  });

  app.get("/api/products", async (req) => {
    const q = parse(
      z.object({
        category: z.string().max(80).optional(),
        q: z.string().trim().max(80).optional(),
        sort: z.enum(["smart", "new", "price_asc", "price_desc"]).default("smart"),
        page: z.coerce.number().int().min(1).max(500).default(1),
      }),
      req.query,
    );
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(q.category ? { category: { slug: q.category, isActive: true } } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: "insensitive" } },
              { description: { contains: q.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const pageSize = 24;
    if (q.sort === "smart") {
      const page = await smartPage(q, pageSize);
      return { products: page.items.map(serializeProduct), total: page.total, page: q.page, pageSize };
    }
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      q.sort === "price_asc"
        ? [{ basePrice: "asc" }]
        : q.sort === "price_desc"
          ? [{ basePrice: "desc" }]
          : [{ createdAt: "desc" }];
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        include: productInclude,
        skip: (q.page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);
    return { products: items.map(serializeProduct), total, page: q.page, pageSize };
  });

  app.get<{ Params: { slug: string } }>("/api/products/:slug", async (req) => {
    const slug = parse(z.string().max(120), req.params.slug);
    const product = await prisma.product.findFirst({
      where: { slug, isActive: true },
      include: productInclude,
    });
    if (!product) throw notFound("Товар не найден");
    return { product: serializeProduct(product) };
  });
}
