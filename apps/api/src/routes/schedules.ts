import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { CreateScheduleRequestSchema } from "@reports/shared";
import type { Storage } from "@reports/storage";
import type { Scheduler } from "../scheduler.js";

/**
 * Schedules CRUD plus a manual `run-now` endpoint.
 *
 * Creating, updating (enable/disable), or deleting a schedule
 * synchronously updates the in-process Scheduler so the cron job
 * registry stays in lockstep with persistent state.
 */
export function registerScheduleRoutes(
  app: FastifyInstance,
  storage: Storage,
  scheduler: Scheduler,
): void {
  app.post("/schedules", async (req, reply) => {
    const parsed = CreateScheduleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    if (!cron.validate(parsed.data.cron)) {
      return reply.code(400).send({ error: "invalid_cron", message: parsed.data.cron });
    }
    const created = await storage.createSchedule({
      name: parsed.data.name,
      cron: parsed.data.cron,
      target: parsed.data.target,
      format: parsed.data.format,
      delivery: parsed.data.delivery,
      enabled: parsed.data.enabled,
    });
    if (created.enabled) scheduler.register(created);
    return reply.code(201).send(created);
  });

  app.get("/schedules", async () => storage.listSchedules());

  app.get<{ Params: { id: string } }>("/schedules/:id", async (req, reply) => {
    const s = await storage.getSchedule(req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    return s;
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; name?: string; cron?: string } }>(
    "/schedules/:id",
    async (req, reply) => {
      const s = await storage.getSchedule(req.params.id);
      if (!s) return reply.code(404).send({ error: "not_found" });
      if (req.body.cron && !cron.validate(req.body.cron)) {
        return reply.code(400).send({ error: "invalid_cron", message: req.body.cron });
      }
      const updated = await storage.updateSchedule(req.params.id, {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.cron !== undefined ? { cron: req.body.cron } : {}),
        ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
      });
      if (!updated) return reply.code(404).send({ error: "not_found" });
      // Re-register so the cron job picks up the new state.
      scheduler.unregister(req.params.id);
      if (updated.enabled) scheduler.register(updated);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/schedules/:id", async (req, reply) => {
    scheduler.unregister(req.params.id);
    const ok = await storage.deleteSchedule(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/schedules/:id/run-now", async (req, reply) => {
    const result = await scheduler.runOnce(req.params.id);
    return reply.send(result);
  });
}
