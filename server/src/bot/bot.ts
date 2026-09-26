import { InlineKeyboard, InputFile, type Context } from "grammy";
import type { Message } from "grammy/types";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { botImagePath } from "../lib/files.js";
import { getStoreSettings } from "../lib/settings.js";
import { channelAllowed, collect, updateFromEdit, type ImportPart, type ImportResult } from "../services/channelImport.js";
import { REJECT_REASONS, rub } from "../services/notify.js";
import { STATUS_TEXT } from "../services/orders.js";
import { approvePayment, rejectPayment } from "../services/payments.js";
import { describeDevice, findPendingTelegramLogin, resolveTelegramLogin } from "../services/telegramLogin.js";
import { bot } from "./instance.js";

const shopUrl = () => `${config.PUBLIC_URL}/`;

type Reply = (text: string, other?: Parameters<typeof bot.api.sendMessage>[2]) => Promise<unknown>;

async function askLoginConfirmation(reply: Reply, publicId: string) {
  const login = await findPendingTelegramLogin(publicId);
  if (!login) {
    await reply("Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.");
    return;
  }
  const host = new URL(config.PUBLIC_URL).host;
  const what = login.linkUserId
    ? `Привязка Telegram к аккаунту на ${host}`
    : login.client === "IOS"
      ? "Вход в приложение CHEBU для сотрудников"
      : `Вход на сайт ${host}`;
  const time = login.createdAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  await reply(
    `${what}\n\nУстройство: ${describeDevice(login.userAgent)}\nЗапрос создан: ${time} МСК\n\nЕсли это вы — подтвердите. Если вы ничего не нажимали, отмените и никому не пересылайте ссылку.`,
    {
      reply_markup: new InlineKeyboard()
        .text("✅ Подтвердить вход", `tl:a:${publicId}`)
        .row()
        .text("Отмена", `tl:d:${publicId}`),
    },
  );
}

async function staffByTelegram(tgId: number) {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
  if (!user || user.isBlocked || (user.role !== "ADMIN" && user.role !== "MANAGER")) return null;
  return user;
}

let welcomePhoto = { file: "", id: "" };

async function sendWelcome(ctx: Context) {
  const store = await getStoreSettings();
  const markup = new InlineKeyboard().webApp(store.botButton, shopUrl());
  if (store.botWelcomePhoto) {
    const photo = welcomePhoto.file === store.botWelcomePhoto ? welcomePhoto.id : new InputFile(botImagePath(store.botWelcomePhoto));
    const fits = store.botWelcome.length <= 1024;
    try {
      const sent = await ctx.replyWithPhoto(photo, fits ? { caption: store.botWelcome, reply_markup: markup } : {});
      const id = sent.photo?.[sent.photo.length - 1]?.file_id;
      if (id) welcomePhoto = { file: store.botWelcomePhoto, id };
      if (fits) return;
    } catch (e) {
      welcomePhoto = { file: "", id: "" };
      console.warn(`welcome photo failed: ${(e as Error).message}`);
    }
  }
  await ctx.reply(store.botWelcome, { reply_markup: markup, link_preview_options: { is_disabled: true } });
}

function toPart(msg: Message, sourceChat: string, messageId: number): ImportPart {
  return {
    sourceChat,
    messageId,
    text: msg.caption ?? msg.text ?? "",
    photo: msg.photo?.[msg.photo.length - 1]?.file_id,
    groupId: msg.media_group_id,
  };
}

const answered = new WeakSet<ImportResult>();

function describeResult(r: ImportResult) {
  const link = (id: string) => `${config.PUBLIC_URL}/admin/products/${id}`;
  if (r.status === "skipped") return { text: `Не удалось добавить товар: ${r.reason}.` };
  const title = `${r.product.title} — ${rub(r.product.basePrice)}`;
  const text =
    r.status === "created"
      ? `✅ Товар добавлен: ${title}
Фото: ${r.photos}${r.product.isActive && r.photos ? "" : "\nТовар скрыт — проверьте и опубликуйте."}`
      : r.status === "sold"
        ? `Отмечено как продано: ${title}`
        : `Товар обновлён: ${title}`;
  return { text, kb: new InlineKeyboard().url("Открыть в админке", link(r.product.id)) };
}

export function setupBot() {
  bot.catch((err) => console.error("bot error:", err.error));

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (payload.startsWith("login_")) {
      await askLoginConfirmation(ctx.reply.bind(ctx), payload.slice(6));
      return;
    }
    await sendWelcome(ctx);
  });

  bot.on("channel_post", async (ctx) => {
    const msg = ctx.channelPost;
    if (!(await channelAllowed(msg.chat.id))) return;
    void collect(toPart(msg, String(msg.chat.id), msg.message_id), true).then((r) => {
      if (r.status === "skipped") console.info(`import: post ${msg.message_id} skipped: ${r.reason}`);
    });
  });

  bot.on("edited_channel_post", async (ctx) => {
    const msg = ctx.editedChannelPost;
    if (!(await channelAllowed(msg.chat.id))) return;
    void updateFromEdit(toPart(msg, String(msg.chat.id), msg.message_id)).catch((e) =>
      console.warn(`import: edit failed: ${(e as Error).message}`),
    );
  });

  bot.callbackQuery(/^tl:(a|d):([A-Za-z0-9_-]{22})$/, async (ctx) => {
    const [, action, publicId] = ctx.match;
    const approve = action === "a";
    const ok = await resolveTelegramLogin(publicId!, approve, ctx.from);
    if (!ok) {
      await ctx.answerCallbackQuery({ text: "Запрос устарел. Начните вход заново.", show_alert: true });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      return;
    }
    await ctx.answerCallbackQuery({ text: approve ? "Вход подтверждён" : "Вход отменён" });
    await ctx
      .editMessageText(
        approve
          ? "✅ Вход подтверждён.\n\nВернитесь в браузер или приложение — вход завершится автоматически."
          : "Вход отменён. Если это были не вы — просто проигнорируйте.",
      )
      .catch(() => undefined);
  });

  bot.command("orders", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    if (!user) {
      const store = await getStoreSettings();
      await ctx.reply("Заказов пока нет. Откройте магазин кнопкой ниже.", {
        reply_markup: new InlineKeyboard().webApp(store.botButton, shopUrl()),
      });
      return;
    }
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (!orders.length) {
      await ctx.reply("Заказов пока нет.");
      return;
    }
    const kb = new InlineKeyboard();
    orders.forEach((o) => kb.webApp(`№${o.number} · ${STATUS_TEXT[o.status]}`, `${config.PUBLIC_URL}/orders/${o.number}`).row());
    await ctx.reply("Ваши последние заказы:", { reply_markup: kb });
  });

  bot.command("help", async (ctx) => {
    const store = await getStoreSettings();
    await ctx.reply(store.botHelp, { link_preview_options: { is_disabled: true } });
  });

  bot.callbackQuery(/^rc:(a|r):([a-z0-9]{10,40})(?::(\d))?$/, async (ctx) => {
    const staff = await staffByTelegram(ctx.from.id);
    if (!staff) {
      await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
      return;
    }
    const [, action, orderId, reasonIdx] = ctx.match;
    try {
      const order =
        action === "a"
          ? await approvePayment(orderId!, staff.id, "telegram")
          : await rejectPayment(orderId!, staff.id, REJECT_REASONS[Number(reasonIdx)] ?? "Оплата не подтверждена", "telegram");
      const who = staff.telegramUsername ? `@${staff.telegramUsername}` : (staff.firstName ?? "админ");
      const verdict =
        action === "a" ? `✅ Оплата подтверждена (${who})` : `✕ Чек отклонён: ${order.rejectReason} (${who})`;
      await ctx.answerCallbackQuery({ text: action === "a" ? "Подтверждено" : "Отклонено" });
      await ctx.editMessageCaption({
        caption: `Заказ №${order.number} · ${rub(order.total)}\n${verdict}`,
        reply_markup: new InlineKeyboard().url("Открыть в админке", `${config.PUBLIC_URL}/admin/orders/${order.number}`),
      }).catch(() => undefined);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: (e as Error).message.slice(0, 190), show_alert: true });
    }
  });

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const origin = msg.forward_origin;
    const fromChannel = origin?.type === "channel";
    if (!fromChannel && !msg.photo) return;
    if (!(await staffByTelegram(ctx.from.id))) return;
    const part = fromChannel
      ? toPart(msg, String(origin.chat.id), origin.message_id)
      : toPart(msg, `dm${ctx.from.id}`, msg.message_id);
    const chatId = ctx.chat.id;
    void collect(part, false).then(async (r) => {
      if (answered.has(r)) return;
      answered.add(r);
      const { text, kb } = describeResult(r);
      const hint =
        fromChannel && !(await channelAllowed(origin.chat.id))
          ? `\n\nКанал «${origin.chat.title}», ID ${origin.chat.id}. Чтобы новые посты добавлялись сами, добавьте бота в администраторы канала и укажите этот ID в админке → Настройки → Импорт из канала.`
          : "";
      await bot.api.sendMessage(chatId, text + hint, kb ? { reply_markup: kb } : {}).catch(() => undefined);
    });
  });
}

let configured = false;

export async function startBot() {
  if (!configured) {
    setupBot();
    configured = true;
  }
  await bot.init();
  const menuButton = config.PUBLIC_URL.startsWith("https://")
    ? { type: "web_app" as const, text: "Магазин", web_app: { url: shopUrl() } }
    : undefined;
  await Promise.allSettled([
    bot.api.setMyCommands([
      { command: "start", description: "Открыть магазин" },
      { command: "orders", description: "Мои заказы" },
      { command: "help", description: "Помощь" },
    ]),
    menuButton ? bot.api.setChatMenuButton({ menu_button: menuButton }) : Promise.resolve(),
  ]);

  if (config.TELEGRAM_USE_WEBHOOK) {
    await bot.api.setWebhook(`${config.PUBLIC_URL}/api/telegram/webhook`, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    });
    console.info("telegram: webhook mode");
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: ["message", "callback_query", "channel_post", "edited_channel_post"], onStart: () => console.info("telegram: polling mode") });
  }
}
