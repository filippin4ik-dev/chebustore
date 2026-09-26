import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { bot } from "../bot/instance.js";
import { config } from "../config.js";
import { forbidden, notFound } from "../lib/errors.js";

export default async function telegramRoutes(app: FastifyInstance) {
  app.post("/api/telegram/webhook", { config: { rateLimit: false } }, async (req) => {
    if (!config.TELEGRAM_USE_WEBHOOK || !config.TELEGRAM_WEBHOOK_SECRET) throw notFound();
    const got = Buffer.from(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""));
    const want = Buffer.from(config.TELEGRAM_WEBHOOK_SECRET);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw forbidden();
    await bot.handleUpdate(req.body as any);
    return { ok: true };
  });
}
