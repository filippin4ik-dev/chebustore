import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { conflict } from "../lib/errors.js";
import { notifyStatus } from "./notify.js";
import { transition } from "./orders.js";

export async function approvePayment(orderId: string, actorId: string, via: string, ip?: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "PAYMENT_REVIEW" && order.status !== "AWAITING_PAYMENT") {
    throw conflict("Оплата по заказу уже обработана");
  }
  const { order: updated } = await transition({
    orderId,
    to: "ASSEMBLING",
    actorId,
    note: "Оплата подтверждена",
    data: { rejectReason: "" },
  });
  await prisma.paymentReceipt.updateMany({
    where: { orderId, reviewedAt: null },
    data: { reviewedAt: new Date(), reviewerId: actorId, approved: true },
  });
  await audit(actorId, "payment.approve", "order", orderId, { number: order.number, via }, ip);
  void notifyStatus(updated);
  return updated;
}

export async function rejectPayment(orderId: string, actorId: string, reason: string, via: string, ip?: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "PAYMENT_REVIEW") throw conflict("Заказ не ожидает проверки оплаты");
  const { order: updated } = await transition({
    orderId,
    to: "AWAITING_PAYMENT",
    actorId,
    note: `Чек отклонён: ${reason}`,
    data: {
      rejectReason: reason,
      paymentDeadline: new Date(Math.max(order.paymentDeadline.getTime(), Date.now() + 24 * 60 * 60 * 1000)),
    },
  });
  await prisma.paymentReceipt.updateMany({
    where: { orderId, reviewedAt: null },
    data: { reviewedAt: new Date(), reviewerId: actorId, approved: false, note: reason },
  });
  await audit(actorId, "payment.reject", "order", orderId, { number: order.number, reason, via }, ip);
  void notifyStatus(updated);
  return updated;
}
