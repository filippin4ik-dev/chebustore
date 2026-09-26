import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { apnsConfigured } from "../lib/apns.js";
import { badRequest, forbidden } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireStaff } from "../plugins/auth.js";
import { pushToDevices } from "../services/push.js";

const tokenField = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{64,200}$/, "Некорректный токен устройства")
  .transform((t) => t.toLowerCase());

const limit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

export default async function pushRoutes(app: FastifyInstance) {
  app.post("/api/push/device", limit, async (req) => {
    const user = requireStaff(req);
    const session = req.auth!.session;
    if (session.client !== "IOS") throw forbidden("Уведомления доступны только в приложении CHEBU");
    const body = parse(z.object({ token: tokenField, environment: z.enum(["sandbox", "production"]) }), req.body);
    const environment = body.environment === "production" ? "PRODUCTION" : "SANDBOX";
    await prisma.pushDevice.upsert({
      where: { token: body.token },
      create: { token: body.token, environment, userId: user.id, sessionId: session.id },
      update: { environment, userId: user.id, sessionId: session.id },
    });
    return { ok: true, configured: apnsConfigured() };
  });

  app.post("/api/push/device/remove", limit, async (req) => {
    const user = requireStaff(req);
    const body = parse(z.object({ token: tokenField }), req.body);
    await prisma.pushDevice.deleteMany({ where: { token: body.token, userId: user.id } });
    return { ok: true };
  });

  app.post("/api/push/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireStaff(req);
    if (!apnsConfigured()) throw badRequest("На сервере не настроены ключи Apple (APNS_*)", "push_not_configured");
    const sent = await pushToDevices(
      { userId: user.id, sessionId: req.auth!.session.id },
      { title: "CHEBU", body: "Уведомления работают" },
    );
    if (!sent) throw badRequest("Не удалось доставить уведомление на это устройство", "push_failed");
    return { ok: true };
  });
}
