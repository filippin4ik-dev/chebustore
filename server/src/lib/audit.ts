import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta?: Prisma.InputJsonValue,
  ip?: string,
) {
  await prisma.auditLog
    .create({ data: { actorId, action, entity, entityId, meta, ip } })
    .catch((e) => console.error("audit write failed", e));
}
