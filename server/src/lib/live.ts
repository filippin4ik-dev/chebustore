import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";

export type LiveType = "catalog" | "config" | "cart" | "me" | "order" | "orders" | "users";

export interface LiveEvent {
  type: LiveType;
  number?: number;
}

type Target = "all" | "staff" | { userId: string };

interface Client {
  userId: string | null;
  sessionId: string | null;
  staff: boolean;
  ip: string;
  write(chunk: string): void;
  close(): void;
}

const clients = new Set<Client>();
const perIp = new Map<string, number>();

export const LIVE_MAX_TOTAL = 5000;
export const LIVE_MAX_PER_IP = 20;

const isStaffRole = (role: string) => role === "ADMIN" || role === "MANAGER";

export function canConnect(ip: string) {
  return clients.size < LIVE_MAX_TOTAL && (perIp.get(ip) ?? 0) < LIVE_MAX_PER_IP;
}

export function publish(to: Target, event: LiveEvent) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    if (to === "all" || (to === "staff" && c.staff) || (typeof to === "object" && c.userId === to.userId)) {
      c.write(chunk);
    }
  }
}

export function publishOrder(order: { userId: string; number: number }) {
  publish({ userId: order.userId }, { type: "order", number: order.number });
  publish("staff", { type: "orders", number: order.number });
}

export function openStream(req: FastifyRequest, reply: FastifyReply) {
  const user = req.auth?.user ?? null;
  const ip = req.ip;
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  res.write("retry: 3000\n: ok\n\n");

  let closed = false;
  const client: Client = {
    userId: user?.id ?? null,
    sessionId: req.auth?.session.id ?? null,
    staff: user ? isStaffRole(user.role) : false,
    ip,
    write(chunk) {
      if (!closed) res.write(chunk);
    },
    close() {
      if (!closed) res.end();
      cleanup();
    },
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clients.delete(client);
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n > 0) perIp.set(ip, n);
    else perIp.delete(ip);
  };
  clients.add(client);
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  req.raw.on("close", cleanup);
  res.on("error", cleanup);
}

export function closeStreams(match: { sessionId?: string; userId?: string; exceptSessionId?: string }) {
  for (const c of [...clients]) {
    if (match.exceptSessionId && c.sessionId === match.exceptSessionId) continue;
    if ((match.sessionId && c.sessionId === match.sessionId) || (match.userId && c.userId === match.userId)) c.close();
  }
}

async function heartbeat() {
  const withSession = [...clients].filter((c) => c.sessionId);
  if (withSession.length) {
    const ids = [...new Set(withSession.map((c) => c.sessionId!))];
    const sessions = await prisma.session.findMany({
      where: { id: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, user: { select: { role: true, isBlocked: true } } },
    });
    const valid = new Map(sessions.filter((s) => !s.user.isBlocked).map((s) => [s.id, s.user.role]));
    for (const c of withSession) {
      const role = valid.get(c.sessionId!);
      if (!role) c.close();
      else c.staff = isStaffRole(role);
    }
  }
  for (const c of clients) c.write(": ping\n\n");
}

let timer: NodeJS.Timeout | null = null;

export function startLive() {
  if (timer) return;
  timer = setInterval(() => {
    heartbeat().catch((e) => console.warn(`live heartbeat failed: ${(e as Error).message}`));
  }, 25_000);
  timer.unref();
}

export function stopLive() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const c of [...clients]) c.close();
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function liveOnResponse(req: FastifyRequest, reply: FastifyReply) {
  if (!UNSAFE.has(req.method) || reply.statusCode >= 400) return;
  const url = req.routeOptions.url ?? "";
  const params = (req.params ?? {}) as Record<string, string>;
  const user = req.auth?.user;
  try {
    if (url.startsWith("/api/admin/products") || url.startsWith("/api/admin/categories")) {
      publish("all", { type: "catalog" });
    } else if (url.startsWith("/api/admin/settings")) {
      publish("all", { type: "config" });
    } else if (url === "/api/admin/users/:id" && params.id) {
      publish({ userId: params.id }, { type: "me" });
      publish("staff", { type: "users" });
    } else if (url === "/api/admin/orders/:number") {
      const order = await prisma.order.findUnique({
        where: { number: Number(params.number) || 0 },
        select: { userId: true, number: true },
      });
      if (order) {
        const body = (req.body ?? {}) as Record<string, unknown>;
        if ("trackingNumber" in body || "pickupInfo" in body) publishOrder(order);
        else publish("staff", { type: "orders", number: order.number });
      }
    } else if (url === "/api/orders" && user) {
      publish({ userId: user.id }, { type: "cart" });
      publish({ userId: user.id }, { type: "order" });
      publish("staff", { type: "orders" });
      publish("all", { type: "catalog" });
    } else if (url === "/api/orders/:number/receipt" && user) {
      publishOrder({ userId: user.id, number: Number(params.number) || 0 });
    } else if (url.startsWith("/api/cart") && user) {
      publish({ userId: user.id }, { type: "cart" });
    } else if (url.startsWith("/api/account/") && user) {
      publish({ userId: user.id }, { type: "me" });
    }
  } catch (e) {
    console.warn(`live publish failed: ${(e as Error).message}`);
  }
}
