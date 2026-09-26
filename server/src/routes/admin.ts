import type { FastifyInstance } from "fastify";
import { Prisma, type OrderStatus } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { bot } from "../bot/instance.js";
import { deleteBotImage, deleteProductImage, deleteReceipt, saveBotImage, saveProductImage } from "../lib/files.js";
import { publish, publishOrder } from "../lib/live.js";
import { apnsPublic, parseApnsKey, resetApns } from "../lib/apns.js";
import {
  getImportSettings,
  getPaymentSettings,
  getStoreSettings,
  importSettingsSchema,
  saveApnsSettings,
  saveImportSettings,
  paymentSettingsSchema,
  savePaymentSettings,
  saveStoreSettings,
  sealApnsKey,
  storeSettingsSchema,
} from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { requireAdmin, requireStaff } from "../plugins/auth.js";
import { productInclude, serializeProductAdmin, slugify, uniqueSlug } from "../services/catalog.js";
import { notifyStatus } from "../services/notify.js";
import { nextStatuses, orderInclude, serializeOrder, STATUS_TEXT, transition } from "../services/orders.js";
import { approvePayment, rejectPayment } from "../services/payments.js";
import { publicUser, revokeAllSessions } from "../services/sessions.js";
import { sendReceiptFile } from "./orders.js";

const RESERVED: OrderStatus[] = ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "ASSEMBLING"];

function searchWords(q?: string) {
  return (q ?? "").split(/\s+/).map((w) => w.trim()).filter(Boolean).slice(0, 5);
}

async function phoneMatches(table: "Order" | "User", column: "contactPhone" | "phone", word: string) {
  let digits = word.replace(/[\s()+\-]/g, "");
  if (!/^\d{4,15}$/.test(digits)) return [];
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${Prisma.raw(`"${table}"`)}
    WHERE regexp_replace(${Prisma.raw(`"${column}"`)}, '[^0-9]', '', 'g') LIKE ${`%${digits}%`}
    LIMIT 500`;
  return rows.map((r) => r.id);
}

function channelRef(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^-100\d{5,15}$/.test(v)) return v;
  const m = v.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{3,31})\/?$/i) ?? v.match(/^@?([A-Za-z][A-Za-z0-9_]{3,31})$/);
  return m ? `@${m[1]}` : null;
}

const statusEnum = z.enum([
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "ASSEMBLING",
  "SHIPPED",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
]);
const id = z.string().min(1).max(40);
const kopecks = z.number().int().min(0).max(100_000_000);
const orderNumber = z.coerce.number().int().positive().max(2_000_000_000);

export default async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/stats", async (req) => {
    requireStaff(req);
    const day = 24 * 60 * 60 * 1000;
    const paidStatuses: OrderStatus[] = ["ASSEMBLING", "SHIPPED", "READY_FOR_PICKUP", "COMPLETED"];
    const revenue = async (sinceMs: number) =>
      (
        await prisma.order.aggregate({
          _sum: { total: true },
          _count: true,
          where: { status: { in: paidStatuses }, paidAt: { gte: new Date(Date.now() - sinceMs) } },
        })
      );
    const [byStatus, d1, d7, d30, customers, lowStock] = await Promise.all([
      prisma.order.groupBy({ by: ["status"], _count: true }),
      revenue(day),
      revenue(7 * day),
      revenue(30 * day),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.productVariant.count({ where: { isActive: true, stock: { lte: 2 }, product: { isActive: true } } }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      revenue: {
        day: { sum: d1._sum.total ?? 0, count: d1._count },
        week: { sum: d7._sum.total ?? 0, count: d7._count },
        month: { sum: d30._sum.total ?? 0, count: d30._count },
      },
      customers,
      lowStock,
    };
  });

  app.get("/api/admin/orders", async (req) => {
    requireStaff(req);
    const q = parse(
      z.object({
        status: statusEnum.optional(),
        q: z.string().trim().max(80).optional(),
        user: id.optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      }),
      req.query,
    );
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.user ? { userId: q.user } : {}),
      AND: await Promise.all(searchWords(q.q).map(async (w) => {
        const num = /^\d{1,9}$/.test(w.replace(/^№/, "")) ? Number(w.replace(/^№/, "")) : undefined;
        const phoneIds = await phoneMatches("Order", "contactPhone", w);
        return {
          OR: [
            ...(num ? [{ number: num }] : []),
            { contactName: { contains: w, mode: "insensitive" } },
            { contactPhone: { contains: w } },
            ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
            { user: { email: { contains: w, mode: "insensitive" } } },
            { user: { telegramUsername: { contains: w.replace(/^@/, ""), mode: "insensitive" } } },
            { user: { firstName: { contains: w, mode: "insensitive" } } },
            { user: { lastName: { contains: w, mode: "insensitive" } } },
          ],
        } satisfies Prisma.OrderWhereInput;
      })),
    };
    const pageSize = 30;
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: orderInclude,
      }),
      prisma.order.count({ where }),
    ]);
    return { orders: orders.map((o) => serializeOrder(o, { staff: true })), total, page: q.page, pageSize };
  });

  async function findOrder(raw: string) {
    const order = await prisma.order.findUnique({
      where: { number: parse(orderNumber, raw) },
      include: { ...orderInclude, user: true },
    });
    if (!order) throw notFound("Заказ не найден");
    return order;
  }

  app.delete<{ Params: { number: string } }>("/api/admin/orders/:number", async (req) => {
    const actor = requireAdmin(req);
    const found = await findOrder(req.params.number);
    const receipts = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: found.id },
        include: { items: true, receipts: { select: { fileName: true } } },
      });
      if (!order) throw notFound("Заказ не найден");
      if (RESERVED.includes(order.status)) {
        for (const item of order.items) {
          if (item.variantId) {
            await tx.productVariant.updateMany({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }
      }
      await tx.order.delete({ where: { id: order.id } });
      return order.receipts;
    });
    for (const r of receipts) await deleteReceipt(r.fileName);
    await audit(
      actor.id,
      "order.delete",
      "order",
      found.id,
      { number: found.number, status: found.status, total: found.total, customer: found.userId },
      req.ip,
    );
    publishOrder({ userId: found.userId, number: found.number });
    publish("staff", { type: "orders" });
    if (RESERVED.includes(found.status)) publish("all", { type: "catalog" });
    return { ok: true };
  });

  app.get<{ Params: { number: string } }>("/api/admin/orders/:number", async (req) => {
    requireStaff(req);
    const order = await findOrder(req.params.number);
    return {
      order: serializeOrder(order, { staff: true }),
      customer: publicUser(order.user),
      nextStatuses: nextStatuses(order.status).map((s) => ({ status: s, text: STATUS_TEXT[s] })),
    };
  });

  app.post<{ Params: { number: string } }>("/api/admin/orders/:number/approve", async (req) => {
    const actor = requireStaff(req);
    const order = await findOrder(req.params.number);
    await approvePayment(order.id, actor.id, "admin", req.ip);
    return { ok: true };
  });

  app.post<{ Params: { number: string } }>("/api/admin/orders/:number/reject", async (req) => {
    const actor = requireStaff(req);
    const body = parse(z.object({ reason: z.string().trim().min(3, "Укажите причину").max(300) }), req.body);
    const order = await findOrder(req.params.number);
    await rejectPayment(order.id, actor.id, body.reason, "admin", req.ip);
    return { ok: true };
  });

  app.post<{ Params: { number: string } }>("/api/admin/orders/:number/status", async (req) => {
    const actor = requireStaff(req);
    const body = parse(
      z.object({
        to: statusEnum,
        note: z.string().trim().max(500).default(""),
        trackingNumber: z.string().trim().max(64).optional(),
        pickupInfo: z.string().trim().max(500).optional(),
      }),
      req.body,
    );
    if (body.to === "PAYMENT_REVIEW" || body.to === "AWAITING_PAYMENT") {
      throw badRequest("Для проверки оплаты используйте «Подтвердить» или «Отклонить»");
    }
    const order = await findOrder(req.params.number);
    if (body.to === "ASSEMBLING") {
      await approvePayment(order.id, actor.id, "admin-manual", req.ip);
      return { ok: true };
    }
    const data: Prisma.OrderUpdateInput = {};
    if (body.trackingNumber !== undefined) data.trackingNumber = body.trackingNumber;
    if (body.pickupInfo !== undefined) data.pickupInfo = body.pickupInfo;
    const { order: updated, from } = await transition({
      orderId: order.id,
      to: body.to,
      actorId: actor.id,
      note: body.note,
      data,
    });
    await audit(actor.id, "order.status", "order", order.id, { number: order.number, from, to: body.to }, req.ip);
    void notifyStatus(updated, body.note);
    return { ok: true };
  });

  app.patch<{ Params: { number: string } }>("/api/admin/orders/:number", async (req) => {
    const actor = requireStaff(req);
    const body = parse(
      z.object({
        adminComment: z.string().trim().max(2000).optional(),
        trackingNumber: z.string().trim().max(64).optional(),
        pickupInfo: z.string().trim().max(500).optional(),
      }),
      req.body,
    );
    const order = await findOrder(req.params.number);
    await prisma.order.update({ where: { id: order.id }, data: body });
    await audit(actor.id, "order.update", "order", order.id, { number: order.number, fields: Object.keys(body) }, req.ip);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/admin/receipts/:id", async (req, reply) => {
    requireStaff(req);
    const receipt = await prisma.paymentReceipt.findUnique({ where: { id: parse(id, req.params.id) } });
    if (!receipt) throw notFound();
    return sendReceiptFile(reply, receipt);
  });

  app.get("/api/admin/categories", async (req) => {
    requireStaff(req);
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    return {
      categories: categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        productCount: c._count.products,
      })),
    };
  });

  const categoryBody = z.object({
    name: z.string().trim().min(1).max(64),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,80}$/, "slug: латиница, цифры и дефис")
      .optional(),
    sortOrder: z.number().int().min(-1000).max(1000).default(0),
    isActive: z.boolean().default(true),
  });

  app.post("/api/admin/categories", async (req) => {
    const actor = requireStaff(req);
    const body = parse(categoryBody, req.body);
    const slug = body.slug ?? slugify(body.name);
    if (await prisma.category.findUnique({ where: { slug } })) throw conflict("Категория с таким slug уже есть");
    const category = await prisma.category.create({ data: { ...body, slug } });
    await audit(actor.id, "category.create", "category", category.id, { name: body.name }, req.ip);
    return { category };
  });

  app.patch<{ Params: { id: string } }>("/api/admin/categories/:id", async (req) => {
    const actor = requireStaff(req);
    const body = parse(categoryBody.partial(), req.body);
    const category = await prisma.category.update({ where: { id: parse(id, req.params.id) }, data: body });
    await audit(actor.id, "category.update", "category", category.id, body, req.ip);
    return { category };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/categories/:id", async (req) => {
    const actor = requireStaff(req);
    const categoryId = parse(id, req.params.id);
    await prisma.category.delete({ where: { id: categoryId } });
    await audit(actor.id, "category.delete", "category", categoryId, undefined, req.ip);
    return { ok: true };
  });

  app.get("/api/admin/products", async (req) => {
    requireStaff(req);
    const q = parse(z.object({ q: z.string().trim().max(80).optional() }), req.query);
    const products = await prisma.product.findMany({
      where: q.q ? { title: { contains: q.q, mode: "insensitive" } } : {},
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: productInclude,
      take: 500,
    });
    return { products: products.map(serializeProductAdmin) };
  });

  app.get<{ Params: { id: string } }>("/api/admin/products/:id", async (req) => {
    requireStaff(req);
    const product = await prisma.product.findUnique({ where: { id: parse(id, req.params.id) }, include: productInclude });
    if (!product) throw notFound("Товар не найден");
    return { product: serializeProductAdmin(product) };
  });

  const productBody = z.object({
    title: z.string().trim().min(1, "Название обязательно").max(120),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,80}$/, "slug: латиница, цифры и дефис")
      .optional(),
    description: z.string().trim().max(5000).default(""),
    categoryId: id.nullable().optional(),
    basePrice: kopecks,
    oldPrice: kopecks.nullable().optional(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(-10000).max(10000).default(0),
  });

  app.post("/api/admin/products", async (req) => {
    const actor = requireStaff(req);
    const body = parse(productBody, req.body);
    const slug = await uniqueSlug(body.slug ?? slugify(body.title));
    const product = await prisma.product.create({ data: { ...body, slug }, include: productInclude });
    await audit(actor.id, "product.create", "product", product.id, { title: body.title }, req.ip);
    return { product: serializeProductAdmin(product) };
  });

  app.patch<{ Params: { id: string } }>("/api/admin/products/:id", async (req) => {
    const actor = requireStaff(req);
    const productId = parse(id, req.params.id);
    const body = parse(productBody.partial(), req.body);
    if (body.slug) body.slug = await uniqueSlug(body.slug, productId);
    const product = await prisma.product.update({ where: { id: productId }, data: body, include: productInclude });
    await audit(actor.id, "product.update", "product", productId, { fields: Object.keys(body) }, req.ip);
    return { product: serializeProductAdmin(product) };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/products/:id", async (req) => {
    const actor = requireStaff(req);
    const productId = parse(id, req.params.id);
    const product = await prisma.product.findUnique({ where: { id: productId }, include: { images: true } });
    if (!product) throw notFound();
    await prisma.product.delete({ where: { id: productId } });
    await Promise.all(product.images.map((i) => deleteProductImage(i.fileName)));
    await audit(actor.id, "product.delete", "product", productId, { title: product.title }, req.ip);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/api/admin/products/:id/variants", async (req) => {
    const actor = requireStaff(req);
    const productId = parse(id, req.params.id);
    const body = parse(
      z.object({
        variants: z
          .array(
            z.object({
              id: id.optional(),
              size: z.string().trim().min(1, "Размер обязателен").max(24),
              color: z.string().trim().max(32).default(""),
              sku: z.string().trim().max(64).nullable().optional(),
              price: kopecks.nullable().optional(),
              stock: z.number().int().min(0).max(100000),
              isActive: z.boolean().default(true),
            }),
          )
          .max(100),
      }),
      req.body,
    );
    const keys = new Set<string>();
    for (const v of body.variants) {
      const key = `${v.size.toLowerCase()}|${v.color.toLowerCase()}`;
      if (keys.has(key)) throw badRequest(`Вариант «${v.size} ${v.color}» повторяется`);
      keys.add(key);
    }
    await prisma.$transaction(async (tx) => {
      const existing = await tx.productVariant.findMany({ where: { productId } });
      const keep = new Set(body.variants.map((v) => v.id).filter(Boolean));
      const toDelete = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
      if (toDelete.length) await tx.productVariant.deleteMany({ where: { id: { in: toDelete } } });
      for (const [index, v] of body.variants.entries()) {
        const data = {
          size: v.size,
          color: v.color,
          sku: v.sku || null,
          price: v.price ?? null,
          stock: v.stock,
          isActive: v.isActive,
          sortOrder: index,
        };
        if (v.id && existing.some((e) => e.id === v.id)) {
          await tx.productVariant.update({ where: { id: v.id }, data });
        } else {
          await tx.productVariant.create({ data: { ...data, productId } });
        }
      }
    });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    await audit(actor.id, "product.variants", "product", productId, { count: body.variants.length }, req.ip);
    return { product: serializeProductAdmin(product) };
  });

  app.post<{ Params: { id: string } }>("/api/admin/products/:id/images", async (req) => {
    const actor = requireStaff(req);
    const productId = parse(id, req.params.id);
    const product = await prisma.product.findUnique({ where: { id: productId }, include: { images: true } });
    if (!product) throw notFound();
    if (product.images.length >= 12) throw badRequest("Не больше 12 фото на товар");
    const file = await req.file({ limits: { fileSize: config.productImageMaxBytes, files: 1 } });
    if (!file) throw badRequest("Прикрепите изображение");
    const buf = await file.toBuffer().catch(() => {
      throw badRequest("Файл слишком большой");
    });
    const saved = await saveProductImage(buf);
    await prisma.productImage.create({
      data: { productId, ...saved, sortOrder: product.images.length },
    });
    await audit(actor.id, "product.image.add", "product", productId, undefined, req.ip);
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    return { product: serializeProductAdmin(updated) };
  });

  app.delete<{ Params: { id: string; imageId: string } }>("/api/admin/products/:id/images/:imageId", async (req) => {
    const actor = requireStaff(req);
    const productId = parse(id, req.params.id);
    const image = await prisma.productImage.findFirst({ where: { id: parse(id, req.params.imageId), productId } });
    if (!image) throw notFound();
    await prisma.productImage.delete({ where: { id: image.id } });
    await deleteProductImage(image.fileName);
    await audit(actor.id, "product.image.delete", "product", productId, undefined, req.ip);
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    return { product: serializeProductAdmin(updated) };
  });

  app.put<{ Params: { id: string } }>("/api/admin/products/:id/images/order", async (req) => {
    requireStaff(req);
    const productId = parse(id, req.params.id);
    const body = parse(z.object({ ids: z.array(id).max(12) }), req.body);
    await prisma.$transaction(
      body.ids.map((imageId, index) =>
        prisma.productImage.updateMany({ where: { id: imageId, productId }, data: { sortOrder: index } }),
      ),
    );
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    return { product: serializeProductAdmin(updated) };
  });

  app.get("/api/admin/settings", async (req) => {
    const actor = requireStaff(req);
    const [payment, store, channelImport, apns] = await Promise.all([
      getPaymentSettings(),
      getStoreSettings(),
      getImportSettings(),
      apnsPublic(),
    ]);
    return { store, payment: actor.role === "ADMIN" ? payment : null, import: channelImport, apns };
  });

  app.put("/api/admin/settings/import", async (req) => {
    const actor = requireAdmin(req);
    const body = parse(
      z.object({
        enabled: z.boolean(),
        channel: z.string().trim().max(128).default(""),
        publish: z.boolean().default(true),
        stock: z.coerce.number().int().min(1).max(1000).default(1),
        categoryId: z.union([id, z.literal("")]).default(""),
      }),
      req.body,
    );
    if (body.categoryId && !(await prisma.category.findUnique({ where: { id: body.categoryId } }))) {
      throw badRequest("Категория не найдена");
    }
    const current = await getImportSettings();
    let channelId = "";
    let channelTitle = "";
    const ref = channelRef(body.channel);
    if (body.channel && ref === null) throw badRequest("Укажите канал как @имя, ссылку t.me/имя или числовой ID");
    if (ref !== null && ref === current.channelId) {
      channelId = current.channelId;
      channelTitle = current.channelTitle;
    } else if (ref !== null) {
      const chat = await bot.api.getChat(ref).catch(() => null);
      if (!chat || chat.type !== "channel") {
        throw badRequest("Канал не найден. Добавьте бота в канал администратором и попробуйте ещё раз");
      }
      const me = await bot.api.getMe();
      const member = await bot.api.getChatMember(chat.id, me.id).catch(() => null);
      if (!member || (member.status !== "administrator" && member.status !== "creator")) {
        throw badRequest("Бот не администратор этого канала. Добавьте его в администраторы канала");
      }
      channelId = String(chat.id);
      channelTitle = chat.title;
    }
    if (body.enabled && !channelId) throw badRequest("Укажите канал, из которого добавлять товары");
    const value = importSettingsSchema.parse({ ...body, channelId, channelTitle });
    await saveImportSettings(value);
    await audit(actor.id, "settings.import", "setting", "import", value, req.ip);
    return { import: value };
  });

  app.post("/api/admin/settings/welcome-photo", async (req) => {
    const actor = requireAdmin(req);
    const file = await req.file({ limits: { fileSize: config.productImageMaxBytes, files: 1 } });
    if (!file) throw badRequest("Прикрепите изображение");
    const buf = await file.toBuffer().catch(() => {
      throw badRequest("Файл слишком большой");
    });
    const fileName = await saveBotImage(buf);
    const store = await getStoreSettings();
    const previous = store.botWelcomePhoto;
    await saveStoreSettings({ ...store, botWelcomePhoto: fileName });
    await deleteBotImage(previous);
    await audit(actor.id, "settings.welcome_photo", "setting", "store", { fileName }, req.ip);
    return { store: { ...store, botWelcomePhoto: fileName } };
  });

  app.delete("/api/admin/settings/welcome-photo", async (req) => {
    const actor = requireAdmin(req);
    const store = await getStoreSettings();
    await saveStoreSettings({ ...store, botWelcomePhoto: "" });
    await deleteBotImage(store.botWelcomePhoto);
    await audit(actor.id, "settings.welcome_photo.delete", "setting", "store", undefined, req.ip);
    return { store: { ...store, botWelcomePhoto: "" } };
  });

  app.put("/api/admin/settings/payment", async (req) => {
    const actor = requireAdmin(req);
    const body = parse(paymentSettingsSchema, req.body);
    await savePaymentSettings(body);
    await audit(actor.id, "settings.payment", "setting", "payment", body, req.ip);
    return { payment: body };
  });

  app.put("/api/admin/settings/store", async (req) => {
    const actor = requireAdmin(req);
    const current = await getStoreSettings();
    const body = parse(storeSettingsSchema, {
      ...current,
      ...(req.body && typeof req.body === "object" ? req.body : {}),
      botWelcomePhoto: current.botWelcomePhoto,
    });
    await saveStoreSettings(body);
    await audit(actor.id, "settings.store", "setting", "store", body, req.ip);
    return { store: body };
  });

  app.put("/api/admin/settings/apns", async (req) => {
    const actor = requireAdmin(req);
    const body = parse(
      z.object({
        keyId: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "Key ID — 10 латинских букв и цифр"),
        teamId: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "Team ID — 10 латинских букв и цифр"),
        bundleId: z.string().trim().min(3).max(200).default("ru.chebustore.app"),
        key: z.string().min(80, "Вставьте содержимое файла .p8").max(8000),
      }),
      req.body,
    );
    if (!parseApnsKey(body.key)) throw badRequest("Ключ .p8 не читается. Вставьте файл целиком");
    await saveApnsSettings({
      keyId: body.keyId,
      teamId: body.teamId,
      bundleId: body.bundleId,
      keySeal: sealApnsKey(body.key),
    });
    resetApns();
    await audit(actor.id, "settings.apns", "setting", "apns", { keyId: body.keyId, teamId: body.teamId, bundleId: body.bundleId }, req.ip);
    return { apns: await apnsPublic() };
  });

  app.delete("/api/admin/settings/apns", async (req) => {
    const actor = requireAdmin(req);
    await saveApnsSettings({ keyId: "", teamId: "", bundleId: "ru.chebustore.app", keySeal: "" });
    resetApns();
    await audit(actor.id, "settings.apns.delete", "setting", "apns", undefined, req.ip);
    return { apns: await apnsPublic() };
  });

  app.get("/api/admin/users", async (req) => {
    requireStaff(req);
    const q = parse(
      z.object({
        q: z.string().trim().max(80).optional(),
        role: z.enum(["CUSTOMER", "MANAGER", "ADMIN"]).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      }),
      req.query,
    );
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      AND: await Promise.all(searchWords(q.q).map(async (w) => {
        const phoneIds = await phoneMatches("User", "phone", w);
        const orderPhoneIds = await phoneMatches("Order", "contactPhone", w);
        return {
          OR: [
            { email: { contains: w, mode: "insensitive" } },
            { telegramUsername: { contains: w.replace(/^@/, ""), mode: "insensitive" } },
            { firstName: { contains: w, mode: "insensitive" } },
            { lastName: { contains: w, mode: "insensitive" } },
            { phone: { contains: w } },
            ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
            ...(orderPhoneIds.length ? [{ orders: { some: { id: { in: orderPhoneIds } } } }] : []),
            ...(/^\d{5,15}$/.test(w) ? [{ telegramId: BigInt(w) }] : []),
            { orders: { some: { contactName: { contains: w, mode: "insensitive" } } } },
          ],
        } satisfies Prisma.UserWhereInput;
      })),
    };
    const pageSize = 50;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { orders: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    return {
      users: users.map((u) => ({
        ...publicUser(u),
        isBlocked: u.isBlocked,
        lastLoginAt: u.lastLoginAt,
        orderCount: u._count.orders,
      })),
      total,
      page: q.page,
      pageSize,
    };
  });

  app.patch<{ Params: { id: string } }>("/api/admin/users/:id", async (req) => {
    const actor = requireAdmin(req);
    const userId = parse(id, req.params.id);
    const body = parse(
      z.object({ role: z.enum(["CUSTOMER", "MANAGER", "ADMIN"]).optional(), isBlocked: z.boolean().optional() }),
      req.body,
    );
    if (userId === actor.id) throw badRequest("Нельзя менять роль или блокировать самого себя");
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw notFound();
    const updated = await prisma.user.update({ where: { id: userId }, data: body });
    if (body.isBlocked || (body.role && body.role !== target.role)) await revokeAllSessions(userId);
    await audit(actor.id, "user.update", "user", userId, { before: { role: target.role, isBlocked: target.isBlocked }, after: body }, req.ip);
    return { user: { ...publicUser(updated), isBlocked: updated.isBlocked } };
  });

  app.get("/api/admin/audit", async (req) => {
    requireAdmin(req);
    const q = parse(z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }), req.query);
    const pageSize = 50;
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, email: true, telegramUsername: true, firstName: true } } },
    });
    return { logs, page: q.page, pageSize };
  });
}
