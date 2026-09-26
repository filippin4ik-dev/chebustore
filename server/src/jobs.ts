import { prisma } from "./db.js";
import { notifyStatus } from "./services/notify.js";
import { transition } from "./services/orders.js";

async function expireUnpaidOrders() {
  const overdue = await prisma.order.findMany({
    where: { status: "AWAITING_PAYMENT", paymentDeadline: { lt: new Date() } },
    select: { id: true },
    take: 100,
  });
  for (const { id } of overdue) {
    try {
      const { order } = await transition({
        orderId: id,
        to: "CANCELLED",
        actorId: null,
        note: "Автоотмена: оплата не поступила вовремя",
      });
      void notifyStatus(order, "Срок оплаты истёк, товары вернулись в продажу.");
    } catch {
      // Status changed concurrently (e.g. receipt just uploaded) — skip.
    }
  }
}

async function cleanup() {
  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await Promise.all([
    prisma.emailCode.deleteMany({ where: { createdAt: { lt: weekAgo } } }),
    prisma.appAuthCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.usedTelegramAuth.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] } }),
  ]);
}

export function startJobs() {
  const run = (name: string, fn: () => Promise<void>) => () =>
    fn().catch((e) => console.error(`job ${name} failed`, e));
  const expire = run("expire", expireUnpaidOrders);
  const clean = run("cleanup", cleanup);
  setTimeout(expire, 10_000);
  setInterval(expire, 5 * 60 * 1000);
  setInterval(clean, 60 * 60 * 1000);
}
