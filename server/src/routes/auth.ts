import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionClient, User } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { keyedHash, numericCode, safeEqualHex } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, tooMany, unauthorized } from "../lib/errors.js";
import { sendLoginCode } from "../lib/mailer.js";
import { verifyWebAppInitData } from "../lib/telegram.js";
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
import { consumeTelegramLogin, createTelegramLogin, findTelegramLogin } from "../services/telegramLogin.js";
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

  app.post("/api/auth/telegram/webapp", strictLimit(30, 10), async (req, reply) => {
    const body = parse(z.object({ initData: z.string().min(1).max(8192) }), req.body);
    const tg = verifyWebAppInitData(body.initData, config.TELEGRAM_BOT_TOKEN, config.telegramAuthMaxAgeSec);
    if (!tg) throw unauthorized("Откройте магазин заново из Telegram", "telegram_invalid");
    const user = await upsertTelegramUser(tg);
    return issueSession(req, reply, user, "MINIAPP");
  });

  app.post("/api/auth/telegram/bot/start", strictLimit(30, 10), async (req) => {
    const body = parse(z.object({ client: clientSchema, link: z.boolean().default(false) }), req.body);
    const linkUserId = body.link ? requireUser(req).id : null;
    const login = await createTelegramLogin({
      client: body.client,
      linkUserId,
      userAgent: req.headers["user-agent"] ?? "",
      ip: req.ip,
    });
    const payload = `login_${login.publicId}`;
    const bot = config.TELEGRAM_BOT_USERNAME;
    return {
      id: login.publicId,
      secret: login.secret,
      expiresAt: login.expiresAt,
      url: `https://t.me/${bot}?start=${payload}`,
      appUrl: `tg://resolve?domain=${bot}&start=${payload}`,
    };
  });

  app.post("/api/auth/telegram/bot/poll", strictLimit(150, 1), async (req, reply) => {
    const body = parse(z.object({ id: z.string().max(64), secret: z.string().max(128) }), req.body);
    const rec = await findTelegramLogin(body.id, body.secret);
    if (!rec) throw badRequest("Запрос входа не найден, начните заново", "login_not_found");
    if (rec.status === "DENIED") throw badRequest("Вход отменён в Telegram", "login_denied");
    if (rec.status === "USED") throw badRequest("Этот вход уже выполнен, начните заново", "login_used");
    if (rec.status === "PENDING") {
      if (rec.expiresAt < new Date()) throw badRequest("Время на вход истекло, начните заново", "login_expired");
      return { status: "pending" as const };
    }
    if (!rec.telegramId || !(await consumeTelegramLogin(rec.id))) {
      throw badRequest("Этот вход уже выполнен, начните заново", "login_used");
    }
    const tg = {
      id: rec.telegramId,
      username: rec.tgUsername ?? undefined,
      firstName: rec.tgFirstName ?? undefined,
      lastName: rec.tgLastName ?? undefined,
    };

    if (rec.linkUserId) {
      const user = requireUser(req);
      if (user.id !== rec.linkUserId) throw forbidden("Войдите в тот же аккаунт и повторите привязку");
      const other = await prisma.user.findUnique({ where: { telegramId: tg.id } });
      if (other && other.id !== user.id) throw conflict("Этот Telegram уже привязан к другому аккаунту");
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { telegramId: tg.id, telegramUsername: tg.username ?? null },
      });
      return { status: "linked" as const, user: publicUser(updated) };
    }

    const user = await upsertTelegramUser(tg);
    const result = await issueSession(req, reply, user, rec.client);
    void notifyNewLogin(user, rec.client === "IOS" ? "iPhone" : "Telegram", req.headers["user-agent"] ?? "");
    return { status: "ok" as const, ...result };
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
