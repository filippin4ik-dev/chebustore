import type { FastifyInstance } from "fastify";
import { tooMany } from "../lib/errors.js";
import { canConnect, openStream } from "../lib/live.js";

export default async function liveRoutes(app: FastifyInstance) {
  app.get("/api/events", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!canConnect(req.ip)) throw tooMany("Слишком много открытых вкладок");
    openStream(req, reply);
  });
}
