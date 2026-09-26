import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { BANKS } from "../lib/banks.js";
import { DELIVERY_METHODS, getStoreSettings } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { productInclude, serializeProduct } from "../services/catalog.js";

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
        sort: z.enum(["new", "price_asc", "price_desc"]).default("new"),
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
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      q.sort === "price_asc"
        ? [{ basePrice: "asc" }]
        : q.sort === "price_desc"
          ? [{ basePrice: "desc" }]
          : [{ sortOrder: "asc" }, { createdAt: "desc" }];
    const pageSize = 24;
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
