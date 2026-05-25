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
import { createTenantResolver, resolveDefaultOrgId } from "./tenant.js";

const PORT = Number.parseInt(process.env.API_PORT ?? "3001", 10);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "300", 10);
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW ?? "1 minute";

export async function buildServer() {
  const storage = await Storage.open(DATA_DIR);
  const audit = new AuditLog(defaultAuditLogPath(DATA_DIR));
  await audit.open();

  // Resolve a default org id once at boot so dev-mode requests
  // (AUTH_REQUIRED=false) have a stable tenant.
  const defaultOrgId = await resolveDefaultOrgId(storage);
  const tenants = createTenantResolver(storage, defaultOrgId);

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

  const auth = await registerAuth(app, { storage, dataDir: DATA_DIR });

  // Audit hook: every non-GET request after it completes.
  app.addHook("onResponse", async (req, reply) => {
    const m = req.method.toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;
    if (req.url === "/auth/login" || req.url === "/auth/register") return;
    audit.write({
      event: "http.request",
      userId: req.principal?.userId ?? null,
      orgId: req.principal?.orgId ?? defaultOrgId,
      method: m,
      path: req.url.split("?")[0]!,
      status: reply.statusCode,
      ip: req.ip,
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    aiEnabled: (process.env.AI_ENABLED ?? "false").toLowerCase() === "true",
    authRequired: auth.required,
    dataDir: DATA_DIR,
  }));

  registerAuthRoutes(app, storage, audit);

  // Auth gate on every other route when AUTH_REQUIRED=true.
  app.addHook("onRequest", async (req, reply) => {
    if (!auth.required) return;
    const p = req.url.split("?")[0]!;
    if (p === "/health" || p.startsWith("/auth/")) return;
    await auth.requireAuth(req, reply);
  });

  app.post("/recommend-chart", async (req, reply) => {
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_profile", issues: parsed.error.issues });
    }
    return reply.send(await recommendChart(parsed.data));
  });

  registerUploadRoutes(app, tenants);
  registerSourceRoutes(app, tenants);
  registerDatasetRoutes(app, tenants);
  registerChartRoutes(app, tenants);
  registerDashboardRoutes(app, tenants);
  registerExportRoutes(app, tenants);
  const scheduler = new Scheduler(storage, app.log);
  registerScheduleRoutes(app, tenants, scheduler);
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
