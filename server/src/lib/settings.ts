import { z } from "zod";
import { prisma } from "../db.js";
import { BANKS, bankIds } from "./banks.js";
import { open, seal } from "./crypto.js";

export const DELIVERY_METHODS = ["CDEK", "RUSSIAN_POST", "HAND"] as const;
export type DeliveryMethodKey = (typeof DELIVERY_METHODS)[number];

const LEGACY_DELIVERY: Record<string, DeliveryMethodKey> = { PICKUP: "HAND", COURIER: "CDEK", POST: "RUSSIAN_POST" };

function renameLegacyKeys(v: unknown) {
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  for (const [from, to] of Object.entries(LEGACY_DELIVERY)) {
    if (from in out) {
      if (!(to in out)) out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}

function toBankId(v: unknown) {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s || bankIds.includes(s)) return s;
  const low = s.toLowerCase();
  const found = BANKS.find((b) => b.name.toLowerCase() === low || low.includes(b.name.toLowerCase()));
  return found ? found.id : "other";
}

const bankField = z.preprocess(toBankId, z.union([z.literal(""), z.enum(bankIds as [string, ...string[]])]).default(""));
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Цвет в формате #RRGGBB");

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export const BG_LIGHT_MIN = 0.6;
export const BG_DARK_MAX = 0.05;

const bgLight = hexColor.refine((c) => luminance(c) >= BG_LIGHT_MIN, "Фон светлой темы слишком тёмный — текст будет плохо читаться");
const bgDark = hexColor.refine((c) => luminance(c) <= BG_DARK_MAX, "Фон тёмной темы слишком светлый — текст будет плохо читаться");

export const paymentSettingsSchema = z.object({
  sbpPhone: z.string().trim().max(32).default(""),
  sbpBank: bankField,
  cardNumber: z
    .string()
    .trim()
    .max(32)
    .regex(/^[\d ]*$/, "Номер карты — только цифры")
    .default(""),
  cardBank: bankField,
  recipientName: z.string().trim().max(96).default(""),
  instructions: z.string().trim().max(1000).default(""),
  paymentWindowHours: z.coerce.number().int().min(1).max(168).default(24),
});

const price = z.coerce.number().int().min(0).max(10_000_000).default(0);

export const DEFAULT_WELCOME =
  "Привет! Это CHEBU.\n\nКаталог, корзина и статусы заказов — внутри приложения. Нажмите кнопку ниже, чтобы открыть магазин.";

export const ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "ASSEMBLING",
  "SHIPPED",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
] as const;

export const DEFAULT_STATUS_TEXTS: Record<(typeof ORDER_STATUSES)[number], string> = {
  AWAITING_PAYMENT: "Ожидает оплаты. Реквизиты и сумма — внутри заказа.",
  PAYMENT_REVIEW: "Чек получен, проверяем оплату.",
  ASSEMBLING: "Оплата получена, спасибо! Собираем заказ.",
  SHIPPED: "Заказ передан в доставку.",
  READY_FOR_PICKUP: "Заказ прибыл, можно забирать.",
  COMPLETED: "Заказ получен. Спасибо за покупку!",
  CANCELLED: "Заказ отменён.",
};

export const DEFAULT_HELP =
  "/start — открыть магазин\n/orders — мои заказы\n\nПо вопросам заказа напишите в поддержку из профиля в магазине.";

const statusText = (s: (typeof ORDER_STATUSES)[number]) =>
  z.string().trim().min(1).max(500).catch(DEFAULT_STATUS_TEXTS[s]).default(DEFAULT_STATUS_TEXTS[s]);

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(1).max(64).default("CHEBU"),
  supportTelegram: z.string().trim().max(64).default(""),
  supportEmail: z.string().trim().max(128).default(""),
  pickupAddress: z.string().trim().max(300).default(""),
  deliveryPrices: z.preprocess(
    renameLegacyKeys,
    z.object({ CDEK: price, RUSSIAN_POST: price, HAND: price }).default({}),
  ),
  deliveryEnabled: z.preprocess(
    renameLegacyKeys,
    z
      .object({
        CDEK: z.boolean().default(true),
        RUSSIAN_POST: z.boolean().default(true),
        HAND: z.boolean().default(true),
      })
      .default({}),
  ),
  accentLight: hexColor.default("#000000"),
  accentDark: hexColor.default("#FFFFFF"),
  bgLight: bgLight.default("#F2F2F7"),
  bgDark: bgDark.default("#000000"),
  botWelcome: z.string().trim().min(1).max(3000).default(DEFAULT_WELCOME),
  botButton: z.string().trim().min(1).max(32).default("Открыть магазин"),
  botWelcomePhoto: z
    .string()
    .regex(/^([A-Za-z0-9_-]+\.jpg)?$/)
    .default(""),
  botHelp: z.string().trim().min(1).max(2000).default(DEFAULT_HELP),
  botStatusTexts: z
    .object(Object.fromEntries(ORDER_STATUSES.map((s) => [s, statusText(s)])) as {
      [K in (typeof ORDER_STATUSES)[number]]: ReturnType<typeof statusText>;
    })
    .default({}),
});

export const importSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().max(32).default(""),
  channelTitle: z.string().max(128).default(""),
  publish: z.boolean().default(true),
  stock: z.coerce.number().int().min(1).max(1000).default(1),
  categoryId: z.string().max(40).default(""),
});

export type ImportSettings = z.infer<typeof importSettingsSchema>;

export const apnsSettingsSchema = z.object({
  keyId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9]{10})?$/, "Key ID — 10 латинских букв и цифр")
    .default(""),
  teamId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9]{10})?$/, "Team ID — 10 латинских букв и цифр")
    .default(""),
  bundleId: z.string().trim().min(1).max(200).default("ru.chebustore.app"),
  keySeal: z.string().max(8000).default(""),
});

export type ApnsSettings = z.infer<typeof apnsSettingsSchema>;

export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

async function read<T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const parsed = schema.safeParse(row?.value ?? {});
  if (parsed.success) return parsed.data;
  const raw = (row?.value ?? {}) as Record<string, unknown>;
  const partial: Record<string, unknown> = {};
  const defaults = schema.parse({}) as Record<string, unknown>;
  for (const k of Object.keys(defaults)) {
    const one = schema.safeParse({ ...defaults, [k]: raw[k] });
    partial[k] = one.success ? (one.data as Record<string, unknown>)[k] : defaults[k];
  }
  return partial as T;
}

export const getPaymentSettings = () => read("payment", paymentSettingsSchema);
export const getStoreSettings = () => read("store", storeSettingsSchema);
export const getImportSettings = () => read("import", importSettingsSchema);
export const getApnsSettings = () => read("apns", apnsSettingsSchema);

export function apnsKeyPlain(s: ApnsSettings) {
  if (!s.keySeal) return "";
  try {
    return open("apns-key", s.keySeal);
  } catch {
    return "";
  }
}

export function sealApnsKey(pem: string) {
  return seal("apns-key", pem);
}

export async function saveImportSettings(value: ImportSettings) {
  await prisma.setting.upsert({ where: { key: "import" }, create: { key: "import", value }, update: { value } });
}

export async function saveApnsSettings(value: ApnsSettings) {
  await prisma.setting.upsert({ where: { key: "apns" }, create: { key: "apns", value }, update: { value } });
}

export async function savePaymentSettings(value: PaymentSettings) {
  await prisma.setting.upsert({ where: { key: "payment" }, create: { key: "payment", value }, update: { value } });
}

export async function saveStoreSettings(value: StoreSettings) {
  await prisma.setting.upsert({ where: { key: "store" }, create: { key: "store", value }, update: { value } });
}

export function paymentIsConfigured(p: PaymentSettings) {
  return Boolean(p.sbpPhone || p.cardNumber);
}
