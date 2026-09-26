import type { Role, User } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { forbidden } from "../lib/errors.js";
import type { TelegramIdentity } from "../lib/telegram.js";

function bootstrapRole(email: string | null, telegramId: bigint | null): Role | null {
  if (email && config.bootstrapAdminEmails.includes(email)) return "ADMIN";
  if (telegramId && config.bootstrapAdminTelegramIds.includes(telegramId.toString())) return "ADMIN";
  return null;
}

async function applyBootstrap(user: User): Promise<User> {
  const role = bootstrapRole(user.email, user.telegramId);
  if (role && user.role !== role) {
    return prisma.user.update({ where: { id: user.id }, data: { role } });
  }
  return user;
}

function assertActive(user: User) {
  if (user.isBlocked) throw forbidden("Аккаунт заблокирован. Напишите в поддержку.", "blocked");
}

export async function upsertTelegramUser(tg: TelegramIdentity): Promise<User> {
  const profile = {
    telegramUsername: tg.username ?? null,
    firstName: tg.firstName ?? null,
    lastName: tg.lastName ?? null,
    photoUrl: tg.photoUrl?.startsWith("https://") ? tg.photoUrl : null,
  };
  const user = await prisma.user.upsert({
    where: { telegramId: tg.id },
    create: { telegramId: tg.id, ...profile },
    update: profile,
  });
  assertActive(user);
  return applyBootstrap(user);
}

export async function upsertEmailUser(email: string): Promise<User> {
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, emailVerifiedAt: new Date() },
    update: {},
  });
  assertActive(user);
  const verified = user.emailVerifiedAt
    ? user
    : await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return applyBootstrap(verified);
}

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}
