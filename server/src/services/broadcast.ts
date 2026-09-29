import { InlineKeyboard, InputFile } from "grammy";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { bot } from "../bot/instance.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { botImagePath } from "../lib/files.js";
import { badRequest } from "../lib/errors.js";
import { getStoreSettings } from "../lib/settings.js";

export const audienceSchema = z.object({
  segment: z.enum(["all", "buyers", "never", "quiet", "category"]),
  categoryId: z.string().max(40).default(""),
  quietDays: z.coerce.number().int().min(1).max(365).default(30),
  includeStaff: z.boolean().default(false),
});

export const broadcastBodySchema = z.object({
  text: z.string().trim().min(1, "Напишите текст").max(3500),
  photo: z.string().regex(/^([A-Za-z0-9_-]+\.jpg)?$/).default(""),
  buttonKind: z.enum(["none", "shop", "category", "product", "url"]).default("shop"),
  buttonLabel: z.string().trim().max(32).default(""),
  buttonTarget: z.string().trim().max(500).default(""),
  audience: audienceSchema,
});

export type BroadcastBody = z.infer<typeof broadcastBodySchema>;

const running = new Set<string>();

function audienceWhere(audience: z.infer<typeof audienceSchema>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    telegramId: { not: null },
    isBlocked: false,
    marketingOptOut: false,
  };
  if (!audience.includeStaff) where.role = "CUSTOMER";
  const bought = { status: { not: "CANCELLED" as const } };
  if (audience.segment === "buyers") where.orders = { some: bought };
  if (audience.segment === "never") where.orders = { none: bought };
  if (audience.segment === "quiet") {
    const since = new Date(Date.now() - audience.quietDays * 24 * 60 * 60 * 1000);
    where.NOT = { orders: { some: { ...bought, createdAt: { gte: since } } } };
  }
  if (audience.segment === "category") {
    where.orders = { some: { ...bought, items: { some: { variant: { product: { categoryId: audience.categoryId } } } } } };
  }
  return where;
}

export async function countRecipients(audience: z.infer<typeof audienceSchema>) {
  if (audience.segment === "category" && !audience.categoryId) throw badRequest("Выберите категорию");
  return prisma.user.count({ where: audienceWhere(audience) });
}

function personalize(text: string, user: { firstName: string | null; telegramUsername: string | null }) {
  const name = user.firstName?.trim() || "друг";
  const username = user.telegramUsername ? `@${user.telegramUsername}` : name;
  return text.replaceAll("{имя}", name).replaceAll("{ник}", username);
}

async function keyboard(body: BroadcastBody) {
  const store = await getStoreSettings();
  const kb = new InlineKeyboard();
  const label = body.buttonLabel || (body.buttonKind === "shop" ? store.botButton : "Открыть");
  if (body.buttonKind === "shop") kb.webApp(label, `${config.PUBLIC_URL}/`);
  else if (body.buttonKind === "category") {
    const category = await prisma.category.findUnique({ where: { id: body.buttonTarget } });
    if (!category) throw badRequest("Категория для кнопки не найдена");
    kb.webApp(label, `${config.PUBLIC_URL}/?c=${encodeURIComponent(category.slug)}`);
  } else if (body.buttonKind === "product") {
    const product = await prisma.product.findFirst({ where: { OR: [{ id: body.buttonTarget }, { slug: body.buttonTarget }] } });
    if (!product) throw badRequest("Товар для кнопки не найден");
    kb.webApp(label, `${config.PUBLIC_URL}/p/${product.slug}`);
  } else if (body.buttonKind === "url") {
    let url: URL;
    try {
      url = new URL(body.buttonTarget);
    } catch {
      throw badRequest("Ссылка кнопки должна начинаться с https://");
    }
    if (url.protocol !== "https:") throw badRequest("Ссылка кнопки должна начинаться с https://");
    kb.url(label, url.toString());
  }
  kb.row().text("Не присылать", "bc:off");
  return kb;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliver(
  chatId: string,
  text: string,
  photo: string,
  fileId: { current: string },
  markup: InlineKeyboard,
) {
  const extra = { reply_markup: markup, link_preview_options: { is_disabled: true as const } };
  if (!photo) {
    await bot.api.sendMessage(chatId, text, extra);
    return;
  }
  const media = fileId.current || new InputFile(botImagePath(photo));
  if (text.length <= 1024) {
    const sent = await bot.api.sendPhoto(chatId, media, { caption: text, reply_markup: markup });
    const id = sent.photo?.[sent.photo.length - 1]?.file_id;
    if (id) fileId.current = id;
    return;
  }
  const sent = await bot.api.sendPhoto(chatId, media);
  const id = sent.photo?.[sent.photo.length - 1]?.file_id;
  if (id) fileId.current = id;
  await bot.api.sendMessage(chatId, text, extra);
}

export async function sendTestBroadcast(actorTelegramId: bigint | null, body: BroadcastBody) {
  if (!actorTelegramId) throw badRequest("Сначала привяжите Telegram к аккаунту администратора");
  const markup = await keyboard(body);
  const user = await prisma.user.findUnique({ where: { telegramId: actorTelegramId } });
  await deliver(actorTelegramId.toString(), personalize(body.text, user ?? { firstName: null, telegramUsername: null }), body.photo, { current: "" }, markup);
}

export async function startBroadcast(actorId: string, body: BroadcastBody) {
  if ([...running].length) throw badRequest("Рассылка уже идёт");
  const total = await countRecipients(body.audience);
  if (!total) throw badRequest("По этому фильтру никого нет. В бота должны хотя бы раз написать /start");
  const markup = await keyboard(body);
  const row = await prisma.broadcast.create({
    data: {
      text: body.text,
      photo: body.photo,
      buttonKind: body.buttonKind,
      buttonLabel: body.buttonLabel,
      buttonTarget: body.buttonTarget,
      audience: body.audience,
      total,
      createdById: actorId,
    },
  });
  running.add(row.id);
  void runBroadcast(row.id, body, markup);
  return row;
}

async function runBroadcast(id: string, body: BroadcastBody, markup: InlineKeyboard) {
  const fileId = { current: "" };
  let sent = 0;
  let failed = 0;
  try {
    const users = await prisma.user.findMany({
      where: audienceWhere(body.audience),
      select: { id: true, telegramId: true, firstName: true, telegramUsername: true },
    });
    for (const user of users) {
      if (!user.telegramId) continue;
      const text = personalize(body.text, user);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          await deliver(user.telegramId.toString(), text, body.photo, fileId, markup);
          ok = true;
        } catch (e) {
          const err = e as { error_code?: number; parameters?: { retry_after?: number }; description?: string };
          if (err.parameters?.retry_after) {
            await sleep(err.parameters.retry_after * 1000);
            continue;
          }
          if (err.error_code === 403) {
            await prisma.user.update({ where: { id: user.id }, data: { marketingOptOut: true } }).catch(() => undefined);
          }
          break;
        }
      }
      if (ok) sent++;
      else failed++;
      if ((sent + failed) % 10 === 0) {
        await prisma.broadcast.update({ where: { id }, data: { sent, failed } }).catch(() => undefined);
      }
      await sleep(40);
    }
    await prisma.broadcast.update({
      where: { id },
      data: { sent, failed, status: "done", finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.broadcast.update({
      where: { id },
      data: { sent, failed, status: "failed", finishedAt: new Date() },
    }).catch(() => undefined);
    console.error(`broadcast failed: ${(e as Error).message}`);
  } finally {
    running.delete(id);
  }
}

export function publicBroadcast(row: {
  id: string;
  text: string;
  photo: string;
  buttonKind: string;
  buttonLabel: string;
  buttonTarget: string;
  audience: unknown;
  status: string;
  total: number;
  sent: number;
  failed: number;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
