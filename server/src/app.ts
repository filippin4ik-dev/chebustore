import { readFile } from "node:fs/promises";
import path from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";
import Fastify, { type FastifyError } from "fastify";
import { config } from "./config.js";
import { dirs } from "./lib/files.js";
import { HttpError } from "./lib/errors.js";
import authPlugin from "./plugins/auth.js";
import addressRoutes from "./routes/address.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import cartRoutes from "./routes/cart.js";
import catalogRoutes from "./routes/catalog.js";
import orderRoutes from "./routes/orders.js";
import telegramRoutes from "./routes/telegram.js";

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    logger: {
      level: config.isProd ? "info" : "debug",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-telegram-bot-api-secret-token\"]"],
        remove: true,
      },
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CS-CSRF"],
    maxAge: 600,
  });
  await app.register(cookie, { hook: "onRequest" });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: { code: "rate_limited", message: "Слишком много запросов, попробуйте через минуту" },
    }),
  });
  await app.register(multipart, { limits: { fileSize: config.productImageMaxBytes, files: 1, fields: 5, parts: 6 } });
  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError | HttpError | Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return reply.status(404).send({ error: { code: "not_found", message: "Не найдено" } });
      if (err.code === "P2002") {
        return reply.status(409).send({ error: { code: "conflict", message: "Такая запись уже существует" } });
      }
      if (err.code === "P2003") {
        return reply.status(409).send({ error: { code: "conflict", message: "Запись используется и не может быть удалена" } });
      }
    }
    const fe = err as FastifyError;
    if (fe.statusCode === 429) return reply.status(429).send(fe);
    if (fe.statusCode && fe.statusCode < 500) {
      const message =
        fe.code === "FST_REQ_FILE_TOO_LARGE" ? "Файл слишком большой" : fe.statusCode === 413 ? "Слишком большой запрос" : "Некорректный запрос";
      return reply.status(fe.statusCode).send({ error: { code: fe.code ?? "bad_request", message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "internal", message: "Внутренняя ошибка, попробуйте позже" } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Не найдено" } }),
  );

  app.get("/api/health", { config: { rateLimit: false } }, async () => ({ ok: true }));

  app.get<{ Params: { file: string } }>("/media/products/:file", async (req, reply) => {
    if (!/^[A-Za-z0-9_-]+\.webp$/.test(req.params.file)) return reply.status(404).send();
    try {
      const buf = await readFile(path.join(dirs.products, req.params.file));
      return reply
        .header("Content-Type", "image/webp")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(buf);
    } catch {
      return reply.status(404).send();
    }
  });

  await app.register(catalogRoutes);
  await app.register(authRoutes);
  await app.register(cartRoutes);
  await app.register(orderRoutes);
  await app.register(adminRoutes);
  await app.register(addressRoutes);
  await app.register(telegramRoutes);

  return app;
}
