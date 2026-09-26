import type { Role, Session, User } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { forbidden, HttpError, unauthorized } from "../lib/errors.js";
import { resolveSession } from "../services/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: { user: User; session: Session; via: "cookie" | "bearer" } | null;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originAllowed(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (origin) return config.allowedOrigins.includes(origin);
  const referer = req.headers.referer;
  if (referer) {
    try {
      return config.allowedOrigins.includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("auth", null);

  app.addHook("preHandler", async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const s = await resolveSession(header.slice(7).trim());
      if (!s) throw unauthorized("Сессия истекла, войдите снова", "session_expired");
      if (s.client === "IOS" && s.user.role !== "ADMIN" && s.user.role !== "MANAGER") {
        throw unauthorized("Приложение CHEBU только для сотрудников магазина", "staff_only");
      }
      req.auth = { user: s.user, session: s, via: "bearer" };
      return;
    }

    const cookie = req.cookies[config.sessionCookie];
    if (UNSAFE.has(req.method) && req.url.startsWith("/api/") && !req.url.startsWith("/api/telegram/")) {
      if (cookie || req.headers.origin) {
        if (!originAllowed(req) || req.headers["x-cs-csrf"] !== "1") {
          throw new HttpError(403, "csrf", "Запрос отклонён политикой безопасности");
        }
      }
    }
    if (cookie) {
      const s = await resolveSession(cookie);
      if (s) req.auth = { user: s.user, session: s, via: "cookie" };
    }
  });
});

export function requireUser(req: FastifyRequest): User {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

export function requireRole(req: FastifyRequest, roles: Role[]): User {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export const requireStaff = (req: FastifyRequest) => requireRole(req, ["ADMIN", "MANAGER"]);
export const requireAdmin = (req: FastifyRequest) => requireRole(req, ["ADMIN"]);
