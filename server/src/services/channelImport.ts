import type { Product } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { bot } from "../bot/instance.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
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

async function downloadPhoto(fileId: string) {
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

async function attachPhotos(productId: string, photos: string[]) {
  const have = await prisma.productImage.count({ where: { productId } });
  let added = 0;
  for (const fileId of photos.slice(0, Math.max(0, MAX_IMAGES - have))) {
    try {
      const buf = await downloadPhoto(fileId);
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

async function importPost(parts: ImportPart[], fromChannel: boolean): Promise<ImportResult> {
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
    const added = hasImages ? 0 : await attachPhotos(product.id, photos);
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
  const added = await attachPhotos(product.id, photos);
  if (!added && product.isActive) await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
  await audit(null, "product.import", "product", product.id, { sourceKey, photos: added });
  publish("all", { type: "catalog" });
  if (fromChannel) await tellStaff(product, post, added);
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
