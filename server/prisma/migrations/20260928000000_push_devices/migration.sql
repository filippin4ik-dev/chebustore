CREATE TYPE "PushEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "environment" "PushEnvironment" NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

CREATE INDEX "PushDevice_sessionId_idx" ON "PushDevice"("sessionId");

ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
