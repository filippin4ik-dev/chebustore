import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [who, roleArg = "ADMIN"] = process.argv.slice(2);
  if (!who) throw new Error("Укажите email или Telegram ID");
  const role = roleArg.toUpperCase();
  if (!["ADMIN", "MANAGER", "CUSTOMER"].includes(role)) throw new Error("Роль: ADMIN | MANAGER | CUSTOMER");

  const where = /^\d+$/.test(who) ? { telegramId: BigInt(who) } : { email: who.trim().toLowerCase() };
  const create = /^\d+$/.test(who)
    ? { telegramId: BigInt(who) }
    : { email: who.trim().toLowerCase(), emailVerifiedAt: new Date() };
  const user = await prisma.user.upsert({
    where,
    create: { ...create, role: role as "ADMIN" },
    update: { role: role as "ADMIN", isBlocked: false },
  });
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  console.log(`Готово: ${who} → ${role}. Войдите заново.`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
