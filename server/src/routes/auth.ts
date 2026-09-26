import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionClient, User } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { keyedHash, numericCode, pkceChallenge, randomToken, safeEqualHex } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, tooMany, unauthorized } from "../lib/errors.js";
import { sendLoginCode } from "../lib/mailer.js";
import { verifyLoginWidget, verifyWebAppInitData, type TelegramIdentity } from "../lib/telegram.js";
import { parse } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import { notifyNewLogin } from "../services/notify.js";
import {
  clearSessionCookie,
  createSession,
  isStaff,
  publicUser,
  revokeAllSessions,
  setSessionCookie,
} from "../services/sessions.js";
import { normalizeEmail, upsertEmailUser, upsertTelegramUser } from "../services/users.js";

const emailSchema = z.string().trim().toLowerCase().max(254).email("Некорректный email");
const clientSchema = z.enum(["WEB", "IOS"]).default("WEB");
const strictLimit = (max: number, minutes: number) => ({
  config: { rateLimit: { max, timeWindow: `${minutes} minutes` } },
});

const staffOnly = () => forbidden("Приложение CHEBU только для сотрудников магазина", "staff_only");

async function issueSession(req: FastifyRequest, reply: FastifyReply, user: User, client: SessionClient) {
  if (client === "IOS" && !isStaff(user.role)) throw staffOnly();
  const { token, expiresAt } = await createSession(user, client, req);
  if (client === "WEB") {
    setSessionCookie(reply, token, expiresAt);
    return { user: publicUser(user) };
  }
  return { user: publicUser(user), token, expiresAt };
}

async function consumeTelegramHash(tg: TelegramIdentity) {
  await prisma.usedTelegramAuth.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    await prisma.usedTelegramAuth.create({
      data: {
        hash: tg.hash,
        expiresAt: new Date((tg.authDate + config.telegramAuthMaxAgeSec) * 1000),
      },
    });
  } catch {
    throw unauthorized("Эти данные входа уже использованы, повторите вход", "replay");
  }
}

async function checkEmailCode(email: string, code: string) {
  const record = await prisma.emailCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) throw badRequest("Код истёк или не запрашивался. Запросите новый.", "code_expired");
  if (record.attempts >= config.emailCodeMaxAttempts) {
    throw tooMany("Слишком много неверных попыток. Запросите новый код.", "code_locked");
  }
  const ok = safeEqualHex(record.codeHash, keyedHash("email-code", `${email}:${code}`));
  if (!ok) {
    const updated = await prisma.emailCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    const left = config.emailCodeMaxAttempts - updated.attempts;
    throw badRequest(
      left > 0 ? `Неверный код. Осталось попыток: ${left}` : "Неверный код. Запросите новый.",
      "code_invalid",
    );
  }
  const consumed = await prisma.emailCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw badRequest("Код уже использован", "code_used");
}

export default async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (req) => ({ user: req.auth ? publicUser(req.auth.user) : null }));

  app.post("/api/auth/email/request", strictLimit(20, 10), async (req) => {
    const body = parse(z.object({ email: emailSchema }), req.body);
    const email = normalizeEmail(body.email);
    const now = Date.now();

    const last = await prisma.emailCode.findFirst({ where: { email }, orderBy: { createdAt: "desc" } });
    if (last && now - last.createdAt.getTime() < config.emailCodeResendSec * 1000) {
      const wait = Math.ceil((config.emailCodeResendSec * 1000 - (now - last.createdAt.getTime())) / 1000);
      return { ok: true, resendIn: wait };
    }
    const today = await prisma.emailCode.count({
      where: { email, createdAt: { gt: new Date(now - 24 * 60 * 60 * 1000) } },
    });
    if (today >= config.emailCodeDailyLimit) throw tooMany("Лимит писем на сегодня исчерпан");

    const existing = await prisma.user.findUnique({ where: { email }, select: { isBlocked: true } });
    if (existing?.isBlocked) return { ok: true, resendIn: config.emailCodeResendSec };

    const code = numericCode(6);
    await prisma.$transaction([
      prisma.emailCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.emailCode.create({
        data: {
          email,
          codeHash: keyedHash("email-code", `${email}:${code}`),
          ip: req.ip,
          expiresAt: new Date(now + config.emailCodeTtlMin * 60 * 1000),
        },
      }),
    ]);
    await sendLoginCode(email, code);
    return { ok: true, resendIn: config.emailCodeResendSec };
  });

  app.post("/api/auth/email/verify", strictLimit(30, 10), async (req, reply) => {
    const body = parse(
      z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, "Код — 6 цифр"), client: clientSchema }),
      req.body,
    );
    const email = normalizeEmail(body.email);
    await checkEmailCode(email, body.code);
    const user = await upsertEmailUser(email);
    const result = await issueSession(req, reply, user, body.client);
    void notifyNewLogin(user, "почта", req.headers["user-agent"] ?? "");
    return result;
  });

  app.post("/api/auth/telegram/widget", strictLimit(10, 10), async (req, reply) => {
    const body = parse(z.object({ data: z.record(z.unknown()), client: clientSchema }), req.body);
    const tg = verifyLoginWidget(body.data, config.TELEGRAM_BOT_TOKEN, config.telegramAuthMaxAgeSec);
    if (!tg) throw unauthorized("Не удалось подтвердить вход через Telegram", "telegram_invalid");
    await consumeTelegramHash(tg);
    const user = await upsertTelegramUser(tg);
    return issueSession(req, reply, user, body.client);
  });

  app.post("/api/auth/telegram/webapp", strictLimit(30, 10), async (req, reply) => {
    const body = parse(z.object({ initData: z.string().min(1).max(8192) }), req.body);
    const tg = verifyWebAppInitData(body.initData, config.TELEGRAM_BOT_TOKEN, config.telegramAuthMaxAgeSec);
    if (!tg) throw unauthorized("Откройте магазин заново из Telegram", "telegram_invalid");
    const user = await upsertTelegramUser(tg);
    return issueSession(req, reply, user, "MINIAPP");
  });

  app.post("/api/auth/app/code", strictLimit(10, 10), async (req, reply) => {
    const user = requireUser(req);
    if (!isStaff(user.role)) throw staffOnly();
    const body = parse(
      z.object({
        challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
      }),
      req.body,
    );
    const code = randomToken(32);
    await prisma.appAuthCode.create({
      data: {
        codeHash: keyedHash("app-code", code),
        challenge: body.challenge,
        userId: user.id,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      },
    });
    if (req.auth?.via === "cookie") {
      await prisma.session.update({ where: { id: req.auth.session.id }, data: { revokedAt: new Date() } });
      clearSessionCookie(reply);
    }
    const url = new URL(config.IOS_REDIRECT_URI);
    url.searchParams.set("code", code);
    url.searchParams.set("state", body.state);
    return { redirect: url.toString() };
  });

  app.post("/api/auth/app/exchange", strictLimit(10, 10), async (req, reply) => {
    const body = parse(
      z.object({ code: z.string().min(20).max(100), verifier: z.string().min(43).max(128) }),
      req.body,
    );
    const record = await prisma.appAuthCode.findUnique({ where: { codeHash: keyedHash("app-code", body.code) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw unauthorized("Код входа недействителен");
    const consumed = await prisma.appAuthCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw unauthorized("Код входа уже использован");
    if (pkceChallenge(body.verifier) !== record.challenge) throw unauthorized("Код входа недействителен");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    if (user.isBlocked) throw unauthorized("Аккаунт заблокирован", "blocked");
    const result = await issueSession(req, reply, user, "IOS");
    void notifyNewLogin(user, "iPhone", req.headers["user-agent"] ?? "");
    return result;
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.auth) {
      await prisma.session.update({ where: { id: req.auth.session.id }, data: { revokedAt: new Date() } });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/account/sessions", async (req) => {
    const user = requireUser(req);
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, client: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
    });
    return { sessions: sessions.map((s) => ({ ...s, current: s.id === req.auth!.session.id })) };
  });

  app.delete<{ Params: { id: string } }>("/api/account/sessions/:id", async (req) => {
    const user = requireUser(req);
    await prisma.session.updateMany({
      where: { id: req.params.id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });

  app.post("/api/account/sessions/revoke-others", async (req) => {
    const user = requireUser(req);
    await revokeAllSessions(user.id, req.auth!.session.id);
    return { ok: true };
  });

  app.patch("/api/account/profile", async (req) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        firstName: z.string().trim().max(64).optional(),
        lastName: z.string().trim().max(64).optional(),
        phone: z
          .string()
          .trim()
          .max(20)
          .regex(/^[+\d\s()-]*$/, "Некорректный телефон")
          .optional(),
      }),
      req.body,
    );
    const updated = await prisma.user.update({ where: { id: user.id }, data: body });
    return { user: publicUser(updated) };
  });

  app.post("/api/account/link/email", strictLimit(10, 10), async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }), req.body);
    const email = normalizeEmail(body.email);
    await checkEmailCode(email, body.code);
    const other = await prisma.user.findUnique({ where: { email } });
    if (other && other.id !== user.id) throw conflict("Эта почта уже привязана к другому аккаунту");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email, emailVerifiedAt: new Date() },
    });
    return { user: publicUser(updated) };
  });

  app.post("/api/account/link/telegram", strictLimit(10, 10), async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ data: z.record(z.unknown()) }), req.body);
    const tg = verifyLoginWidget(body.data, config.TELEGRAM_BOT_TOKEN, config.telegramAuthMaxAgeSec);
    if (!tg) throw unauthorized("Не удалось подтвердить Telegram", "telegram_invalid");
    await consumeTelegramHash(tg);
    const other = await prisma.user.findUnique({ where: { telegramId: tg.id } });
    if (other && other.id !== user.id) throw conflict("Этот Telegram уже привязан к другому аккаунту");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { telegramId: tg.id, telegramUsername: tg.username ?? null },
    });
    return { user: publicUser(updated) };
  });

  app.delete("/api/account/link/telegram", async (req) => {
    const user = requireUser(req);
    if (!user.email) throw badRequest("Сначала привяжите почту, иначе вы потеряете доступ к аккаунту");
    if (req.auth?.session.client === "MINIAPP") throw badRequest("Отвязка Telegram доступна на сайте");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { telegramId: null, telegramUsername: null },
    });
    return { user: publicUser(updated) };
  });
}
