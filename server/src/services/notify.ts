import type { Order, PaymentReceipt, User } from "@prisma/client";
import { InlineKeyboard, InputFile } from "grammy";
import { bot } from "../bot/instance.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { readReceipt } from "../lib/files.js";
import { sendOrderUpdate } from "../lib/mailer.js";
import { STATUS_TEXT } from "./orders.js";

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
export const rub = (kop: number) =>
  `${(kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;

export const REJECT_REASONS = [
  "Платёж не найден",
  "Сумма не совпадает с суммой заказа",
  "Чек не читается",
  "Оплата не на те реквизиты",
];

async function safeSend(chatId: string | bigint, fn: (id: string) => Promise<unknown>) {
  try {
    await fn(chatId.toString());
  } catch (e) {
    console.warn(`telegram send to ${chatId} failed: ${(e as Error).message}`);
  }
}

async function staffChats(): Promise<string[]> {
  if (config.TELEGRAM_ADMIN_CHAT_ID) return [config.TELEGRAM_ADMIN_CHAT_ID];
  const staff = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MANAGER"] }, isBlocked: false, telegramId: { not: null } },
    select: { telegramId: true },
  });
  return staff.map((s) => s.telegramId!.toString());
}

function orderUrl(number: number) {
  return `${config.PUBLIC_URL}/orders/${number}`;
}

export async function notifyStatus(order: Order, note = "") {
  const user = await prisma.user.findUnique({ where: { id: order.userId } });
  if (!user) return;
  const title = STATUS_TEXT[order.status];
  const extra = [
    note,
    order.status === "SHIPPED" && order.trackingNumber ? `Трек-номер: ${order.trackingNumber}` : "",
    order.status === "READY_FOR_PICKUP" && order.pickupInfo ? order.pickupInfo : "",
    order.status === "AWAITING_PAYMENT" && order.rejectReason
      ? `Чек отклонён: ${order.rejectReason}. Проверьте оплату и прикрепите чек заново.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (user.telegramId) {
    const kb = new InlineKeyboard().webApp("Открыть заказ", `${config.PUBLIC_URL}/orders/${order.number}`);
    await safeSend(user.telegramId, (id) =>
      bot.api.sendMessage(id, `<b>Заказ №${order.number}</b>\n${esc(title)}${extra ? `\n\n${esc(extra)}` : ""}`, {
        parse_mode: "HTML",
        reply_markup: kb,
      }),
    );
  }
  if (user.email && user.emailVerifiedAt) {
    await sendOrderUpdate(user.email, order.number, title, extra).catch((e) =>
      console.warn(`order email failed: ${(e as Error).message}`),
    );
  }
}

export async function notifyNewOrder(order: Order) {
  const text = `🛍 Новый заказ <b>№${order.number}</b> на ${rub(order.total)}\n${esc(order.contactName)}, ${esc(order.contactPhone)}\nОжидает оплаты.`;
  const kb = new InlineKeyboard().url("Открыть в админке", `${config.PUBLIC_URL}/admin/orders/${order.number}`);
  for (const chat of await staffChats()) {
    await safeSend(chat, (id) => bot.api.sendMessage(id, text, { parse_mode: "HTML", reply_markup: kb }));
  }
}

export async function notifyReceipt(order: Order, receipt: PaymentReceipt) {
  const caption = `🧾 Чек по заказу <b>№${order.number}</b>\nСумма к оплате: <b>${rub(order.total)}</b>\n${esc(order.contactName)}, ${esc(order.contactPhone)}\n\nСверьте поступление в банке и подтвердите.`;
  const kb = new InlineKeyboard()
    .text("✅ Оплата получена", `rc:a:${order.id}`)
    .row();
  REJECT_REASONS.forEach((reason, i) => kb.text(`✕ ${reason}`, `rc:r:${order.id}:${i}`).row());
  kb.url("Открыть в админке", `${config.PUBLIC_URL}/admin/orders/${order.number}`);

  const file = await readReceipt(receipt.fileName);
  for (const chat of await staffChats()) {
    await safeSend(chat, (id) =>
      receipt.mimeType === "application/pdf"
        ? bot.api.sendDocument(id, new InputFile(file, `receipt-${order.number}.pdf`), {
            caption,
            parse_mode: "HTML",
            reply_markup: kb,
          })
        : bot.api.sendPhoto(id, new InputFile(file, `receipt-${order.number}.webp`), {
            caption,
            parse_mode: "HTML",
            reply_markup: kb,
          }),
    );
  }
}

export async function notifyNewLogin(user: User, method: string, userAgent: string) {
  if (!user.telegramId) return;
  const when = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  await safeSend(user.telegramId, (id) =>
    bot.api.sendMessage(
      id,
      `🔐 Вход в аккаунт chebu store (${esc(method)})\n${when} МСК\n${esc(userAgent.slice(0, 120))}\n\nЕсли это были не вы — откройте Профиль → Устройства и завершите все сеансы.`,
    ),
  );
}

export { orderUrl };
