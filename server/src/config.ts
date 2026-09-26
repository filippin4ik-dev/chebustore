import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_URL: z.string().url().default("http://localhost:5173"),
  EXTRA_ALLOWED_ORIGINS: z.string().default(""),
  TRUST_PROXY: bool.default("false"),

  DATABASE_URL: z.string().min(1),
  DATA_DIR: z.string().default("./data"),

  SERVER_SECRET: z.string().min(32, "SERVER_SECRET должен быть не короче 32 символов"),

  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_BOT_USERNAME: z.string().min(3),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  TELEGRAM_USE_WEBHOOK: bool.default("false"),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: bool.default("true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("chebu store <no-reply@chebustore.ru>"),

  IOS_REDIRECT_URI: z.string().default("chebustore://auth"),

  BOOTSTRAP_ADMIN_EMAILS: z.string().default(""),
  BOOTSTRAP_ADMIN_TELEGRAM_IDS: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Некорректная конфигурация окружения:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === "production") {
  if (!env.PUBLIC_URL.startsWith("https://")) {
    console.error("PUBLIC_URL в production обязан быть https://");
    process.exit(1);
  }
  if (env.TELEGRAM_USE_WEBHOOK && !env.TELEGRAM_WEBHOOK_SECRET) {
    console.error("TELEGRAM_WEBHOOK_SECRET обязателен при TELEGRAM_USE_WEBHOOK=true");
    process.exit(1);
  }
}

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const config = {
  ...env,
  isProd: env.NODE_ENV === "production",
  publicOrigin: new URL(env.PUBLIC_URL).origin,
  allowedOrigins: [new URL(env.PUBLIC_URL).origin, ...list(env.EXTRA_ALLOWED_ORIGINS)],
  bootstrapAdminEmails: list(env.BOOTSTRAP_ADMIN_EMAILS).map((e) => e.toLowerCase()),
  bootstrapAdminTelegramIds: list(env.BOOTSTRAP_ADMIN_TELEGRAM_IDS),
  sessionCookie: env.PUBLIC_URL.startsWith("https://") ? "__Host-cs_session" : "cs_session",
  sessionTtlDays: 30,
  sessionIdleDays: 14,
  staffSessionTtlHours: 24 * 7,
  emailCodeTtlMin: 10,
  emailCodeMaxAttempts: 5,
  emailCodeResendSec: 60,
  emailCodeDailyLimit: 10,
  telegramAuthMaxAgeSec: 60 * 60 * 24,
  receiptMaxBytes: 10 * 1024 * 1024,
  productImageMaxBytes: 15 * 1024 * 1024,
};

export type Config = typeof config;
