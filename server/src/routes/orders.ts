import type { FastifyInstance, FastifyReply } from "fastify";
import type { PaymentReceipt } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { readReceipt, saveReceipt } from "../lib/files.js";
import { DELIVERY_METHODS, getPaymentSettings, getStoreSettings, paymentIsConfigured } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import { notifyNewOrder, notifyReceipt, notifyStaffCancelled, notifyStatus } from "../services/notify.js";
import { orderInclude, serializeOrder, transition } from "../services/orders.js";
import { MAX_QTY } from "./cart.js";

const MAX_OPEN_UNPAID = 3;
const MAX_RECEIPTS = 5;

const checkoutSchema = z
  .object({
    contactName: z.string().trim().min(2, "Укажите имя").max(96),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s()-]{10,20}$/, "Укажите телефон"),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    deliveryAddress: z.string().trim().max(400).default(""),
    comment: z.string().trim().max(500).default(""),
  })
  .refine((d) => d.deliveryMethod === "HAND" || d.deliveryAddress.length >= 5, {
    message: "Укажите адрес доставки",
    path: ["deliveryAddress"],
  });

export async function sendReceiptFile(reply: FastifyReply, receipt: PaymentReceipt) {
  const buf = await readReceipt(receipt.fileName);
  const ext = receipt.fileName.split(".").pop();
  const inline = receipt.mimeType === "image/webp";
  return reply
    .header("Content-Type", receipt.mimeType)
    .header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="receipt-${receipt.id}.${ext}"`)
    .header("Cache-Control", "private, no-store")
    .header("Content-Security-Policy", "default-src 'none'; sandbox")
    .header("X-Content-Type-Options", "nosniff")
    .send(buf);
}

export default async function orderRoutes(app: FastifyInstance) {
  app.post("/api/orders", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const user = requireUser(req);
    const body = parse(checkoutSchema, req.body);

    const [payment, store] = await Promise.all([getPaymentSettings(), getStoreSettings()]);
    if (!paymentIsConfigured(payment)) throw conflict("Приём оплаты временно недоступен, попробуйте позже");
    if (!store.deliveryEnabled[body.deliveryMethod]) throw badRequest("Этот способ доставки недоступен");

    const openUnpaid = await prisma.order.count({
      where: { userId: user.id, status: { in: ["AWAITING_PAYMENT", "PAYMENT_REVIEW"] } },
    });
    if (openUnpaid >= MAX_OPEN_UNPAID) {
      throw conflict("У вас уже есть неоплаченные заказы. Оплатите или отмените их, чтобы оформить новый.");
    }

    const deliveryPrice = store.deliveryPrices[body.deliveryMethod];

    const order = await prisma.$transaction(async (tx) => {
      const cart = await tx.cartItem.findMany({
        where: { userId: user.id },
        include: {
          variant: {
            include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } } },
          },
        },
      });
      if (cart.length === 0) throw badRequest("Корзина пуста");

      let itemsTotal = 0;
      const items = [];
      for (const line of cart) {
        const v = line.variant;
        const p = v.product;
        if (!p.isActive || !v.isActive) throw conflict(`«${p.title}» больше недоступен — уберите его из корзины`);
        if (line.quantity < 1 || line.quantity > MAX_QTY) throw badRequest("Некорректное количество");
        const reserved = await tx.productVariant.updateMany({
          where: { id: v.id, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (reserved.count !== 1) {
          throw conflict(`«${p.title}» (${v.size}) — недостаточно на складе. Обновите корзину.`);
        }
        const unitPrice = v.price ?? p.basePrice;
        itemsTotal += unitPrice * line.quantity;
        items.push({
          variantId: v.id,
          productTitle: p.title,
          size: v.size,
          color: v.color,
          imageFile: p.images[0]?.fileName ?? null,
          unitPrice,
          quantity: line.quantity,
        });
      }

      const created = await tx.order.create({
        data: {
          userId: user.id,
          itemsTotal,
          deliveryPrice,
          total: itemsTotal + deliveryPrice,
          contactName: body.contactName,
          contactPhone: body.contactPhone,
          deliveryMethod: body.deliveryMethod,
          deliveryAddress: body.deliveryMethod === "HAND" ? body.deliveryAddress || store.pickupAddress : body.deliveryAddress,
          customerComment: body.comment,
          paymentSnapshot: {
            sbpPhone: payment.sbpPhone,
            sbpBank: payment.sbpBank,
            cardNumber: payment.cardNumber,
            cardBank: payment.cardBank,
            recipientName: payment.recipientName,
            instructions: payment.instructions,
          },
          paymentDeadline: new Date(Date.now() + payment.paymentWindowHours * 60 * 60 * 1000),
          items: { create: items },
          history: { create: { to: "AWAITING_PAYMENT", actorId: user.id } },
        },
        include: orderInclude,
      });
      await tx.cartItem.deleteMany({ where: { userId: user.id } });
      if (!user.phone) await tx.user.update({ where: { id: user.id }, data: { phone: body.contactPhone } });
      return created;
    });

    void notifyNewOrder(order);
    return { order: serializeOrder(order, { staff: false }) };
  });

  app.get("/api/orders", async (req) => {
    const user = requireUser(req);
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: orderInclude,
    });
    return { orders: orders.map((o) => serializeOrder(o, { staff: false })) };
  });

  async function ownOrder(userId: string, numberRaw: string) {
    const number = parse(z.coerce.number().int().positive().max(2_000_000_000), numberRaw);
    const order = await prisma.order.findFirst({ where: { number, userId }, include: orderInclude });
    if (!order) throw notFound("Заказ не найден");
    return order;
  }

  app.get<{ Params: { number: string } }>("/api/orders/:number", async (req) => {
    const user = requireUser(req);
    return { order: serializeOrder(await ownOrder(user.id, req.params.number), { staff: false }) };
  });

  app.post<{ Params: { number: string } }>(
    "/api/orders/:number/receipt",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const user = requireUser(req);
      const order = await ownOrder(user.id, req.params.number);
      if (order.status !== "AWAITING_PAYMENT" && order.status !== "PAYMENT_REVIEW") {
        throw conflict("Для этого заказа чек уже не нужен");
      }
      if (order.receipts.length >= MAX_RECEIPTS) throw conflict("Достигнут лимит загруженных чеков");

      const file = await req.file({ limits: { fileSize: config.receiptMaxBytes, files: 1, fields: 2 } });
      if (!file) throw badRequest("Прикрепите файл чека");
      const buf = await file.toBuffer().catch(() => {
        throw badRequest("Файл больше 10 МБ");
      });
      const saved = await saveReceipt(buf);
      const receipt = await prisma.paymentReceipt.create({ data: { orderId: order.id, ...saved } });

      let updated = order;
      if (order.status === "AWAITING_PAYMENT") {
        await transition({
          orderId: order.id,
          to: "PAYMENT_REVIEW",
          actorId: user.id,
          data: { rejectReason: "" },
        });
      }
      updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
      void notifyReceipt(updated, receipt);
      return { order: serializeOrder(updated, { staff: false }) };
    },
  );

  app.get<{ Params: { number: string; id: string } }>("/api/orders/:number/receipts/:id", async (req, reply) => {
    const user = requireUser(req);
    const order = await ownOrder(user.id, req.params.number);
    const receipt = order.receipts.find((r) => r.id === req.params.id);
    if (!receipt) throw notFound();
    return sendReceiptFile(reply, receipt);
  });

  app.post<{ Params: { number: string } }>("/api/orders/:number/cancel", async (req) => {
    const user = requireUser(req);
    const order = await ownOrder(user.id, req.params.number);
    if (order.status !== "AWAITING_PAYMENT") {
      throw conflict("Отменить можно только неоплаченный заказ. Напишите в поддержку.");
    }
    const { order: updated } = await transition({
      orderId: order.id,
      to: "CANCELLED",
      actorId: user.id,
      note: "Отменён покупателем",
    });
    void notifyStatus(updated, "Вы отменили заказ.");
    notifyStaffCancelled(updated, "Покупатель отменил заказ");
    const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    return { order: serializeOrder(full, { staff: false }) };
  });
}
