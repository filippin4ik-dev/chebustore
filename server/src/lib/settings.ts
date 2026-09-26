import { z } from "zod";
import { prisma } from "../db.js";

export const paymentSettingsSchema = z.object({
  sbpPhone: z.string().trim().max(32).default(""),
  sbpBank: z.string().trim().max(64).default(""),
  cardNumber: z
    .string()
    .trim()
    .max(32)
    .regex(/^[\d ]*$/, "Номер карты — только цифры")
    .default(""),
  cardBank: z.string().trim().max(64).default(""),
  recipientName: z.string().trim().max(96).default(""),
  instructions: z.string().trim().max(1000).default(""),
  paymentWindowHours: z.coerce.number().int().min(1).max(168).default(24),
});

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(1).max(64).default("ЧЕБУ STORE"),
  supportTelegram: z.string().trim().max(64).default(""),
  supportEmail: z.string().trim().max(128).default(""),
  pickupAddress: z.string().trim().max(300).default(""),
  deliveryPrices: z
    .object({
      PICKUP: z.coerce.number().int().min(0).default(0),
      COURIER: z.coerce.number().int().min(0).default(0),
      POST: z.coerce.number().int().min(0).default(0),
    })
    .default({}),
  deliveryEnabled: z
    .object({
      PICKUP: z.boolean().default(true),
      COURIER: z.boolean().default(true),
      POST: z.boolean().default(true),
    })
    .default({}),
});

export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

async function read<T>(key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const parsed = schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

export const getPaymentSettings = () => read("payment", paymentSettingsSchema);
export const getStoreSettings = () => read("store", storeSettingsSchema);

export async function savePaymentSettings(value: PaymentSettings) {
  await prisma.setting.upsert({ where: { key: "payment" }, create: { key: "payment", value }, update: { value } });
}

export async function saveStoreSettings(value: StoreSettings) {
  await prisma.setting.upsert({ where: { key: "store" }, create: { key: "store", value }, update: { value } });
}

export function paymentIsConfigured(p: PaymentSettings) {
  return Boolean((p.sbpPhone || p.cardNumber) && p.recipientName);
}
