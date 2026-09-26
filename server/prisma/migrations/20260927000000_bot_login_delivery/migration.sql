ALTER TYPE "DeliveryMethod" RENAME VALUE 'PICKUP' TO 'HAND';
ALTER TYPE "DeliveryMethod" RENAME VALUE 'COURIER' TO 'CDEK';
ALTER TYPE "DeliveryMethod" RENAME VALUE 'POST' TO 'RUSSIAN_POST';

DROP TABLE IF EXISTS "AppAuthCode";
DROP TABLE IF EXISTS "UsedTelegramAuth";

CREATE TYPE "TelegramLoginStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DENIED', 'USED');

CREATE TABLE "TelegramLogin" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "client" "SessionClient" NOT NULL,
    "linkUserId" TEXT,
    "status" "TelegramLoginStatus" NOT NULL DEFAULT 'PENDING',
    "telegramId" BIGINT,
    "tgUsername" TEXT,
    "tgFirstName" TEXT,
    "tgLastName" TEXT,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramLogin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramLogin_publicId_key" ON "TelegramLogin"("publicId");
CREATE INDEX "TelegramLogin_expiresAt_idx" ON "TelegramLogin"("expiresAt");
