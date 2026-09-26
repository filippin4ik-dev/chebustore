import type { Role, SessionClient, User } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { keyedHash, randomToken } from "../lib/crypto.js";

const DAY = 24 * 60 * 60 * 1000;
export const isStaff = (role: Role) => role === "ADMIN" || role === "MANAGER";

export async function createSession(user: User, client: SessionClient, req: FastifyRequest) {
  const token = randomToken(32);
  const ttl = isStaff(user.role) ? config.staffSessionTtlHours * 60 * 60 * 1000 : config.sessionTtlDays * DAY;
  const expiresAt = new Date(Date.now() + ttl);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: keyedHash("session", token),
      client,
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 300),
      ip: req.ip,
      expiresAt,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export async function resolveSession(token: string) {
  if (!token || token.length > 100) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: keyedHash("session", token) },
    include: { user: true },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  if (now - session.lastSeenAt.getTime() > config.sessionIdleDays * DAY) return null;
  if (session.user.isBlocked) return null;
  if (now - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
}

export async function revokeAllSessions(userId: string, exceptId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(config.sessionCookie, token, {
    httpOnly: true,
    secure: config.PUBLIC_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(config.sessionCookie, {
    path: "/",
    httpOnly: true,
    secure: config.PUBLIC_URL.startsWith("https://"),
    sameSite: "lax",
  });
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: Boolean(u.emailVerifiedAt),
    telegramId: u.telegramId ? u.telegramId.toString() : null,
    telegramUsername: u.telegramUsername,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    photoUrl: u.photoUrl,
    role: u.role,
    createdAt: u.createdAt,
  };
}
