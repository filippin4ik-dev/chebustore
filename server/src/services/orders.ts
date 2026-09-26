import type { Order, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { conflict } from "../lib/errors.js";

export const STATUS_TEXT: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "Ожидает оплаты",
  PAYMENT_REVIEW: "Оплата на проверке",
  ASSEMBLING: "Оплачен, собирается",
  SHIPPED: "Передан в доставку",
  READY_FOR_PICKUP: "Прибыл, можно забрать",
  COMPLETED: "Получен",
  CANCELLED: "Отменён",
};

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ["PAYMENT_REVIEW", "ASSEMBLING", "CANCELLED"],
  PAYMENT_REVIEW: ["ASSEMBLING", "AWAITING_PAYMENT", "CANCELLED"],
  ASSEMBLING: ["SHIPPED", "READY_FOR_PICKUP", "CANCELLED"],
  SHIPPED: ["READY_FOR_PICKUP", "COMPLETED", "CANCELLED"],
  READY_FOR_PICKUP: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from].includes(to);
export const nextStatuses = (from: OrderStatus) => TRANSITIONS[from];

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actorId: string | null;
  note?: string;
  data?: Prisma.OrderUpdateInput;
}

/** Atomically moves an order to a new status; returns the updated order and the previous status. */
export async function transition({ orderId, to, actorId, note = "", data = {} }: TransitionInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (!canTransition(current.status, to)) {
      throw conflict(`Нельзя перевести заказ из «${STATUS_TEXT[current.status]}» в «${STATUS_TEXT[to]}»`);
    }
    const res = await tx.order.updateMany({
      where: { id: orderId, status: current.status },
      data: {
        status: to,
        ...(to === "ASSEMBLING" && !current.paidAt ? { paidAt: new Date() } : {}),
      },
    });
    if (res.count !== 1) throw conflict("Заказ уже изменён, обновите страницу");

    if (to === "CANCELLED") {
      for (const item of current.items) {
        if (item.variantId) {
          await tx.productVariant.updateMany({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    }

    const order = await tx.order.update({ where: { id: orderId }, data });
    await tx.orderStatusEvent.create({ data: { orderId, from: current.status, to, actorId, note } });
    return { order, from: current.status };
  });
}

export const orderInclude = {
  items: true,
  history: { orderBy: { createdAt: "asc" } },
  receipts: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude;

type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function serializeOrder(o: FullOrder, opts: { staff: boolean }) {
  const showPayment = opts.staff || o.status === "AWAITING_PAYMENT" || o.status === "PAYMENT_REVIEW";
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    statusText: STATUS_TEXT[o.status],
    itemsTotal: o.itemsTotal,
    deliveryPrice: o.deliveryPrice,
    total: o.total,
    contactName: o.contactName,
    contactPhone: o.contactPhone,
    deliveryMethod: o.deliveryMethod,
    deliveryAddress: o.deliveryAddress,
    customerComment: o.customerComment,
    trackingNumber: o.trackingNumber,
    pickupInfo: o.pickupInfo,
    rejectReason: o.rejectReason,
    payment: showPayment ? o.paymentSnapshot : null,
    paymentDeadline: o.paymentDeadline,
    paidAt: o.paidAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    items: o.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productTitle: i.productTitle,
      size: i.size,
      color: i.color,
      image: i.imageFile ? `/media/products/${i.imageFile}` : null,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
    history: o.history.map((h) => ({ from: h.from, to: h.to, note: h.note, createdAt: h.createdAt })),
    receipts: o.receipts.map((r) => ({
      id: r.id,
      mimeType: r.mimeType,
      createdAt: r.createdAt,
      approved: r.approved,
      note: r.note,
    })),
    ...(opts.staff ? { adminComment: o.adminComment, userId: o.userId } : {}),
  };
}

export type OrderLike = Pick<Order, "id" | "number" | "status" | "userId" | "total">;
