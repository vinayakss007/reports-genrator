import Fastify from "fastify";
import cors from "@fastify/cors";
import { recommendChart } from "@reports/ai-gateway";
import { ProfileSchema } from "@reports/shared";

const PORT = Number.parseInt(process.env.API_PORT ?? "3001", 10);

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  });

  app.get("/health", async () => ({
    status: "ok",
    aiEnabled: (process.env.AI_ENABLED ?? "false").toLowerCase() === "true",
  }));

  app.post("/recommend-chart", async (req, reply) => {
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_profile",
        issues: parsed.error.issues,
      });
    }

    // The gateway never throws and always returns a valid result,
    // either AI-decorated or core fallback.
    const result = await recommendChart(parsed.data);
    return reply.send(result);
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

// Run only when invoked directly, not when imported by tests.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("server.js") ||
  process.argv[1]?.endsWith("server.ts");

if (invokedDirectly) {
  void main();
}
