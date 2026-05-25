import { join } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { recommendChart } from "@reports/ai-gateway";
import { ProfileSchema } from "@reports/shared";
import { Storage } from "@reports/storage";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerDatasetRoutes } from "./routes/datasets.js";

const PORT = Number.parseInt(process.env.API_PORT ?? "3001", 10);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");

export async function buildServer() {
  const storage = await Storage.open(DATA_DIR);

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  });

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.get("/health", async () => ({
    status: "ok",
    aiEnabled: (process.env.AI_ENABLED ?? "false").toLowerCase() === "true",
    dataDir: DATA_DIR,
  }));

  // Phase 0: deterministic chart recommendation.
  app.post("/recommend-chart", async (req, reply) => {
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_profile", issues: parsed.error.issues });
    }
    return reply.send(await recommendChart(parsed.data));
  });

  // Phase 1: data plane.
  registerUploadRoutes(app, storage);
  registerSourceRoutes(app, storage);
  registerDatasetRoutes(app, storage);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("server.js") ||
  process.argv[1]?.endsWith("server.ts");

if (invokedDirectly) {
  void main();
}
