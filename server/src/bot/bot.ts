import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getStoreSettings } from "../lib/settings.js";
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

export function setupBot() {
  bot.catch((err) => console.error("bot error:", err.error));

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (payload.startsWith("login_")) {
      await askLoginConfirmation(ctx.reply.bind(ctx), payload.slice(6));
      return;
    }
    const store = await getStoreSettings();
    await ctx.reply(store.botWelcome, {
      reply_markup: new InlineKeyboard().webApp(store.botButton, shopUrl()),
      link_preview_options: { is_disabled: true },
    });
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

  bot.command("help", (ctx) =>
    ctx.reply("/start — открыть магазин\n/orders — мои заказы\n\nПо вопросам заказа ответьте в поддержку из профиля в приложении."),
  );

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
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    console.info("telegram: webhook mode");
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: ["message", "callback_query"], onStart: () => console.info("telegram: polling mode") });
  }
}
