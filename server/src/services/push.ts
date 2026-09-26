import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { apnsConfigured, sendApns } from "../lib/apns.js";

const DEAD_TOKEN = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export interface PushMessage {
  title: string;
  body: string;
  order?: number;
}

export async function pushToDevices(where: Prisma.PushDeviceWhereInput, msg: PushMessage) {
  const failures: string[] = [];
  if (!(await apnsConfigured())) return { sent: 0, devices: 0, failures };
  const devices = await prisma.pushDevice.findMany({
    where: {
      ...where,
      user: { role: { in: ["ADMIN", "MANAGER"] }, isBlocked: false },
      session: { revokedAt: null, expiresAt: { gt: new Date() } },
    },
    take: 200,
  });
  const payload = {
    aps: {
      alert: { title: msg.title, body: msg.body },
      sound: "default",
      "thread-id": msg.order ? `order-${msg.order}` : "chebu",
    },
    ...(msg.order ? { order: msg.order } : {}),
  };
  let sent = 0;
  await Promise.all(
    devices.map(async (d) => {
      const r = await sendApns(d.environment, d.token, payload);
      if (r.ok) {
        sent++;
        return;
      }
      failures.push(r.reason ?? String(r.status));
      if (r.status === 410 || (r.reason && DEAD_TOKEN.has(r.reason))) {
        await prisma.pushDevice.deleteMany({ where: { id: d.id } });
      } else console.warn(`apns push failed: ${r.status} ${r.reason ?? ""}`);
    }),
  );
  return { sent, devices: devices.length, failures };
}

export function pushStaff(msg: PushMessage) {
  return pushToDevices({}, msg).catch((e) => {
    console.warn(`push failed: ${(e as Error).message}`);
    return null;
  });
}
