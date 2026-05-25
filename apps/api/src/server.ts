import { join } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { recommendChart } from "@reports/ai-gateway";
import { ProfileSchema } from "@reports/shared";
import { Storage } from "@reports/storage";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerDatasetRoutes } from "./routes/datasets.js";
import { registerChartRoutes } from "./routes/charts.js";
import { registerDashboardRoutes } from "./routes/dashboards.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerScheduleRoutes } from "./routes/schedules.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { Scheduler } from "./scheduler.js";
import { AuditLog, defaultAuditLogPath } from "./audit.js";
import { registerAuth } from "./auth.js";

const PORT = Number.parseInt(process.env.API_PORT ?? "3001", 10);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "300", 10);
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW ?? "1 minute";

export async function buildServer() {
  const storage = await Storage.open(DATA_DIR);
  const audit = new AuditLog(defaultAuditLogPath(DATA_DIR));
  await audit.open();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  });

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  await app.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
  });

  // Auth (mode controlled by AUTH_REQUIRED env, default false).
  const auth = await registerAuth(app, { storage, dataDir: DATA_DIR });

  // Audit hook: log every mutating request after it completes.
  app.addHook("onResponse", async (req, reply) => {
    const m = req.method.toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;
    if (req.url === "/auth/login" || req.url === "/auth/register") return; // handled inline
    audit.write({
      event: "http.request",
      userId: req.principal?.userId ?? null,
      orgId: req.principal?.orgId ?? null,
      method: m,
      path: req.url.split("?")[0]!,
      status: reply.statusCode,
      ip: req.ip,
    });
  });

  // Public route: liveness.
  app.get("/health", async () => ({
    status: "ok",
    aiEnabled: (process.env.AI_ENABLED ?? "false").toLowerCase() === "true",
    authRequired: auth.required,
    dataDir: DATA_DIR,
  }));

  // Public auth routes.
  registerAuthRoutes(app, storage, audit);

  // All remaining routes go through requireAuth (no-op when AUTH_REQUIRED=false).
  app.addHook("onRequest", async (req, reply) => {
    if (!auth.required) return;
    const p = req.url.split("?")[0]!;
    if (p === "/health" || p.startsWith("/auth/")) return;
    await auth.requireAuth(req, reply);
  });

  // Recommend.
  app.post("/recommend-chart", async (req, reply) => {
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_profile", issues: parsed.error.issues });
    }
    return reply.send(await recommendChart(parsed.data));
  });

  // Phase 1: data plane.
  registerUploadRoutes(app, storage);
  registerSourceRoutes(app, storage);
  registerDatasetRoutes(app, storage);

  // Phase 2/4/6: chart compute + stats.
  registerChartRoutes(app, storage);

  // Phase 3: dashboards, exports, schedules.
  registerDashboardRoutes(app, storage);
  registerExportRoutes(app, storage);
  const scheduler = new Scheduler(storage, app.log);
  registerScheduleRoutes(app, storage, scheduler);
  await scheduler.start();

  app.addHook("onClose", async () => {
    scheduler.stop();
    await audit.close();
  });

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
