import { buildApp } from "./app.js";
import { startBot } from "./bot/bot.js";
import { bot } from "./bot/instance.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startJobs } from "./jobs.js";
import { ensureDirs } from "./lib/files.js";

async function main() {
  await ensureDirs();
  await prisma.$connect();
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
  startJobs();
  startBot().catch((e) => app.log.error(e, "telegram bot failed to start"));

  const shutdown = async () => {
    app.log.info("shutting down");
    await Promise.allSettled([bot.isRunning() ? bot.stop() : Promise.resolve(), app.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
