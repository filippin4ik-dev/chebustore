import type { SessionClient } from "@prisma/client";
import { prisma } from "../db.js";
import { keyedHash, randomToken, safeEqualHex } from "../lib/crypto.js";

export const TELEGRAM_LOGIN_TTL_MS = 10 * 60 * 1000;
export const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export async function createTelegramLogin(input: {
  client: SessionClient;
  linkUserId: string | null;
  userAgent: string;
  ip: string;
}) {
  const publicId = randomToken(16);
  const secret = randomToken(32);
  const expiresAt = new Date(Date.now() + TELEGRAM_LOGIN_TTL_MS);
  await prisma.telegramLogin.create({
    data: {
      publicId,
      secretHash: keyedHash("tg-login", secret),
      client: input.client,
      linkUserId: input.linkUserId,
      userAgent: input.userAgent.slice(0, 300),
      ip: input.ip.slice(0, 64),
      expiresAt,
    },
  });
  return { publicId, secret, expiresAt };
}

export async function findTelegramLogin(publicId: string, secret: string) {
  if (!PUBLIC_ID_RE.test(publicId) || !SECRET_RE.test(secret)) return null;
  const rec = await prisma.telegramLogin.findUnique({ where: { publicId } });
  if (!rec || !safeEqualHex(rec.secretHash, keyedHash("tg-login", secret))) return null;
  return rec;
}

export async function findPendingTelegramLogin(publicId: string) {
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  return prisma.telegramLogin.findFirst({
    where: { publicId, status: "PENDING", expiresAt: { gt: new Date() } },
  });
}

export async function resolveTelegramLogin(
  publicId: string,
  approve: boolean,
  from: { id: number; username?: string; first_name?: string; last_name?: string },
) {
  const res = await prisma.telegramLogin.updateMany({
    where: { publicId, status: "PENDING", expiresAt: { gt: new Date() } },
    data: approve
      ? {
          status: "CONFIRMED",
          telegramId: BigInt(from.id),
          tgUsername: from.username ?? null,
          tgFirstName: from.first_name ?? null,
          tgLastName: from.last_name ?? null,
        }
      : { status: "DENIED", telegramId: BigInt(from.id) },
  });
  return res.count === 1;
}

export async function consumeTelegramLogin(id: string) {
  const res = await prisma.telegramLogin.updateMany({
    where: { id, status: "CONFIRMED" },
    data: { status: "USED" },
  });
  return res.count === 1;
}

export function describeDevice(ua: string) {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const browser = /CHEBU|CFNetwork|Darwin/.test(ua)
    ? "приложение CHEBU"
    : /YaBrowser/.test(ua)
      ? "Яндекс Браузер"
      : /Edg\//.test(ua)
        ? "Edge"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "";
  return [os, browser].filter(Boolean).join(" · ") || "неизвестное устройство";
}
