import { unlink } from "node:fs/promises";
import type { Product } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { bot } from "../bot/instance.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest } from "../lib/errors.js";
import { openTelegramExport } from "./telegramExport.js";
import { deleteProductImage, saveProductImage } from "../lib/files.js";
import { publish } from "../lib/live.js";
import { parsePost, type ParsedPost } from "../lib/postParser.js";
import { getImportSettings, type ImportSettings } from "../lib/settings.js";
import { slugify, uniqueSlug } from "./catalog.js";
import { rub, staffChats } from "./notify.js";

export interface ImportPart {
  sourceChat: string;
  messageId: number;
  text: string;
  photo?: string;
  groupId?: string;
}

export type ImportResult =
  | { status: "created" | "updated" | "sold"; product: Product; photos: number }
  | { status: "skipped"; reason: string };

const MAX_IMAGES = 12;
const MAX_FILE = 20 * 1024 * 1024;
const GROUP_WAIT = 2500;

interface Pending {
  parts: ImportPart[];
  timer: NodeJS.Timeout;
  resolvers: ((r: ImportResult) => void)[];
}

const groups = new Map<string, Pending>();
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function collect(part: ImportPart, fromChannel: boolean): Promise<ImportResult> {
  if (!part.groupId) return serial(() => importPost([part], fromChannel));
  const key = `${part.sourceChat}:${part.groupId}`;
  return new Promise((resolve) => {
    const pending = groups.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      pending.parts.push(part);
      pending.resolvers.push(resolve);
    } else {
      groups.set(key, { parts: [part], resolvers: [resolve], timer: undefined as unknown as NodeJS.Timeout });
    }
    const g = groups.get(key)!;
    g.timer = setTimeout(() => {
      groups.delete(key);
      void serial(() => importPost(g.parts, fromChannel)).then(
        (r) => g.resolvers.forEach((fn) => fn(r)),
        (e) => g.resolvers.forEach((fn) => fn({ status: "skipped", reason: (e as Error).message })),
      );
    }, GROUP_WAIT);
  });
}

async function downloadPhoto(fileId: string, buffers?: Map<string, Buffer>) {
  const local = buffers?.get(fileId);
  if (local) return local;
  const file = await bot.api.getFile(fileId);
  if (!file.file_path || (file.file_size ?? 0) > MAX_FILE) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_FILE ? null : buf;
}

async function guessCategory(post: ParsedPost, settings: ImportSettings) {
  const categories = await prisma.category.findMany({ select: { id: true, name: true, slug: true } });
  const haystack = `${post.title} ${post.tags.join(" ")}`.toLowerCase();
  for (const c of categories) {
    const name = c.name.toLowerCase().trim();
    const stem = name.length > 5 ? name.slice(0, -2) : name.length > 3 ? name.slice(0, -1) : name;
    if (stem.length >= 3 && haystack.includes(stem)) return c.id;
    if (post.tags.includes(c.slug.toLowerCase())) return c.id;
  }
  return categories.some((c) => c.id === settings.categoryId) ? settings.categoryId : null;
}

async function syncVariants(productId: string, post: ParsedPost, stock: number, isNew: boolean) {
  const existing = await prisma.productVariant.findMany({ where: { productId } });
  const wanted = new Set(post.sizes.map((s) => s.toLowerCase()));
  for (const [i, size] of post.sizes.entries()) {
    const found = existing.find((v) => v.size.toLowerCase() === size.toLowerCase() && v.color === "");
    if (found) {
      await prisma.productVariant.update({
        where: { id: found.id },
        data: { isActive: true, sortOrder: i, ...(post.sold ? { stock: 0 } : {}) },
      });
    } else {
      await prisma.productVariant.create({
        data: { productId, size, stock: post.sold ? 0 : stock, sortOrder: i },
      });
    }
  }
  if (!isNew) {
    for (const v of existing) {
      if (!wanted.has(v.size.toLowerCase())) {
        await prisma.productVariant.update({ where: { id: v.id }, data: { isActive: false } });
      }
    }
  }
}

async function attachPhotos(productId: string, photos: string[], buffers?: Map<string, Buffer>) {
  const have = await prisma.productImage.count({ where: { productId } });
  let added = 0;
  for (const fileId of photos.slice(0, Math.max(0, MAX_IMAGES - have))) {
    try {
      const buf = await downloadPhoto(fileId, buffers);
      if (!buf) continue;
      const img = await saveProductImage(buf);
      try {
        await prisma.productImage.create({
          data: { productId, fileName: img.fileName, width: img.width, height: img.height, sortOrder: have + added },
        });
        added++;
      } catch (e) {
        await deleteProductImage(img.fileName);
        throw e;
      }
    } catch (e) {
      console.warn(`import: photo failed: ${(e as Error).message}`);
    }
  }
  return added;
}

async function importPost(parts: ImportPart[], fromChannel: boolean, buffers?: Map<string, Buffer>): Promise<ImportResult> {
  const settings = await getImportSettings();
  const sorted = [...parts].sort((a, b) => a.messageId - b.messageId);
  const main = sorted.find((p) => p.text.trim()) ?? sorted[0]!;
  const post = parsePost(main.text);
  if (!post) return { status: "skipped", reason: "В тексте поста не нашлось названия и цены" };
  const photos = sorted.map((p) => p.photo).filter((p): p is string => !!p);
  const sourceKey = `${main.sourceChat}:${main.messageId}`;
  const existing = await prisma.product.findUnique({ where: { sourceKey } });

  if (existing) {
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { title: post.title, basePrice: post.price * 100, description: post.description },
    });
    await syncVariants(product.id, post, settings.stock, false);
    const hasImages = await prisma.productImage.count({ where: { productId: product.id } });
    const added = hasImages ? 0 : await attachPhotos(product.id, photos, buffers);
    await audit(null, post.sold ? "product.import.sold" : "product.import.update", "product", product.id, { sourceKey });
    publish("all", { type: "catalog" });
    return { status: post.sold ? "sold" : "updated", product, photos: added };
  }

  if (!photos.length && fromChannel) return { status: "skipped", reason: "В посте нет фотографий" };
  const categoryId = await guessCategory(post, settings);
  const product = await prisma.product.create({
    data: {
      slug: await uniqueSlug(slugify(post.title)),
      title: post.title,
      description: post.description,
      basePrice: post.price * 100,
      categoryId,
      isActive: settings.publish && !post.sold,
      sourceKey,
    },
  });
  await syncVariants(product.id, post, settings.stock, true);
  const added = await attachPhotos(product.id, photos, buffers);
  if (!added && product.isActive) await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
  await audit(null, "product.import", "product", product.id, { sourceKey, photos: added });
  publish("all", { type: "catalog" });
  if (fromChannel && !buffers) await tellStaff(product, post, added);
  return { status: "created", product, photos: added };
}

async function tellStaff(product: Product, post: ParsedPost, photos: number) {
  const kb = new InlineKeyboard().url("Открыть в админке", `${config.PUBLIC_URL}/admin/products/${product.id}`);
  const hidden = product.isActive && photos ? "" : "\nТовар скрыт — проверьте и опубликуйте.";
  const text = `Из канала добавлен товар\n${post.title} — ${rub(post.price * 100)}\nРазмеры: ${post.sizes.join(", ")} · фото: ${photos}${hidden}`;
  for (const chat of await staffChats()) {
    await bot.api.sendMessage(chat, text, { reply_markup: kb }).catch(() => undefined);
  }
}

export async function updateFromEdit(part: ImportPart) {
  return serial(async () => {
    const product = await prisma.product.findUnique({ where: { sourceKey: `${part.sourceChat}:${part.messageId}` } });
    if (!product) return null;
    return importPost([part], true);
  });
}

export async function channelAllowed(chatId: number | string) {
  const s = await getImportSettings();
  return s.enabled && s.channelId !== "" && s.channelId === String(chatId);
}

export interface HistoryProgress {
  running: boolean;
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  error: string;
}

const historyJobs = new Map<string, HistoryProgress>();

export function historyStatus(channelId: string) {
  return historyJobs.get(channelId) ?? null;
}

export function visibleHistory(channelId: string) {
  const named = channelId ? historyJobs.get(channelId) : undefined;
  const exported = historyJobs.get("export");
  if (named?.running) return named;
  if (exported?.running) return exported ?? null;
  return named ?? exported ?? null;
}

export async function startHistoryImport(channelId: string, apiId: number, apiHash: string, session: string) {
  const current = historyJobs.get(channelId);
  if (current?.running) return { already: true as const, progress: current };
  const progress: HistoryProgress = { running: true, scanned: 0, created: 0, updated: 0, skipped: 0, error: "" };
  historyJobs.set(channelId, progress);
  void runHistory(channelId, apiId, apiHash, session, progress);
  return { already: false as const, progress };
}

async function runHistory(channelId: string, apiId: number, apiHash: string, session: string, progress: HistoryProgress) {
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions/index.js");
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 2 });
  try {
    await client.connect();
    const entity = await client.getEntity(channelId);
    const albums = new Map<string, { id: number; text: string; photo: boolean }[]>();
    const alone: { id: number; text: string; photo: boolean }[] = [];
    for await (const msg of client.iterMessages(entity, { limit: 4000 })) {
      const text = msg.message ?? "";
      const photo = Boolean(msg.photo);
      if (!text.trim() && !photo) continue;
      const item = { id: msg.id, text, photo };
      const group = msg.groupedId?.toString();
      if (group) {
        const list = albums.get(group) ?? [];
        list.push(item);
        albums.set(group, list);
      } else alone.push(item);
    }
    const batches = [...alone.map((m) => [m]), ...albums.values()];
    for (const batch of batches) {
      const photos = new Map<string, Buffer>();
      const parts: ImportPart[] = [];
      for (const m of batch) {
        let file: string | undefined;
        if (m.photo) {
          try {
            const full = await client.getMessages(entity, { ids: m.id });
            const media = full[0];
            if (!media) continue;
            const buf = (await client.downloadMedia(media, {})) as Buffer | undefined;
            if (buf?.length && buf.length <= MAX_FILE) {
              file = `buf:${m.id}`;
              photos.set(file, buf);
            }
          } catch {
            file = undefined;
          }
        }
        parts.push({ sourceChat: channelId, messageId: m.id, text: m.text, photo: file });
      }
      const result = await serial(() => importPost(parts, true, photos)).catch(
        (e): ImportResult => ({ status: "skipped", reason: (e as Error).message }),
      );
      progress.scanned++;
      if (result.status === "created") progress.created++;
      else if (result.status === "updated" || result.status === "sold") progress.updated++;
      else progress.skipped++;
    }
  } catch (e) {
    progress.error = (e as Error).message.slice(0, 300);
  } finally {
    progress.running = false;
    await client.disconnect().catch(() => undefined);
  }
}

export async function startExportImport(zipPath: string, savedChannelId: string) {
  const key = savedChannelId || "export";
  const current = historyJobs.get(key);
  if (current?.running) {
    await unlink(zipPath).catch(() => undefined);
    return { already: true as const, progress: current };
  }
  const exp = await openTelegramExport(zipPath).catch(async (e: unknown) => {
    await unlink(zipPath).catch(() => undefined);
    throw e;
  });
  if (savedChannelId.startsWith("-100") && exp.channelId && savedChannelId !== exp.channelId) {
    exp.close();
    await unlink(zipPath).catch(() => undefined);
    throw badRequest("Это выгрузка другого канала");
  }
  const sourceChat = savedChannelId.startsWith("-100") ? savedChannelId : exp.channelId;
  if (!sourceChat) {
    exp.close();
    await unlink(zipPath).catch(() => undefined);
    throw badRequest("В выгрузке нет id канала. Сначала сохраните канал в настройках импорта");
  }
  const progress: HistoryProgress = { running: true, scanned: 0, created: 0, updated: 0, skipped: 0, error: "" };
  historyJobs.set(key, progress);
  historyJobs.set("export", progress);
  void runExport(exp, sourceChat, progress, zipPath);
  return { already: false as const, progress };
}

async function runExport(
  exp: Awaited<ReturnType<typeof openTelegramExport>>,
  sourceChat: string,
  progress: HistoryProgress,
  zipPath: string,
) {
  try {
    for (const group of exp.groups) {
      const photos = new Map<string, Buffer>();
      const parts: ImportPart[] = [];
      for (const message of group) {
        let file: string | undefined;
        if (message.photo) {
          const buf = await exp.photo(message.photo);
          if (buf?.length && buf.length <= MAX_FILE) {
            file = `buf:${message.id}`;
            photos.set(file, buf);
          }
        }
        parts.push({ sourceChat, messageId: message.id, text: message.text, photo: file });
      }
      const result = await serial(() => importPost(parts, true, photos)).catch(
        (e): ImportResult => ({ status: "skipped", reason: (e as Error).message }),
      );
      progress.scanned++;
      if (result.status === "created") progress.created++;
      else if (result.status === "updated" || result.status === "sold") progress.updated++;
      else progress.skipped++;
    }
  } catch (e) {
    progress.error = (e as Error).message.slice(0, 300);
  } finally {
    progress.running = false;
    exp.close();
    await unlink(zipPath).catch(() => undefined);
  }
}
