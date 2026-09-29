ALTER TABLE "User" ADD COLUMN "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "photo" TEXT NOT NULL DEFAULT '',
    "buttonKind" TEXT NOT NULL DEFAULT 'shop',
    "buttonLabel" TEXT NOT NULL DEFAULT '',
    "buttonTarget" TEXT NOT NULL DEFAULT '',
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Broadcast_createdAt_idx" ON "Broadcast"("createdAt");

ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
