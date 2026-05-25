import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { CreateScheduleRequestSchema } from "@reports/shared";
import type { TenantResolver } from "../tenant.js";
import type { Scheduler } from "../scheduler.js";

/**
 * Schedule CRUD plus run-now. Every schedule belongs to an org and is
 * looked up via TenantStorage; the in-process Scheduler runs each tick
 * inside the schedule's own org.
 */
export function registerScheduleRoutes(
  app: FastifyInstance,
  tenants: TenantResolver,
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
    const tenant = tenants.for(req);
    const created = await tenant.createSchedule({
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

  app.get("/schedules", async (req) => tenants.for(req).listSchedules());

  app.get<{ Params: { id: string } }>("/schedules/:id", async (req, reply) => {
    const s = await tenants.for(req).getSchedule(req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    return s;
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean; name?: string; cron?: string } }>(
    "/schedules/:id",
    async (req, reply) => {
      const tenant = tenants.for(req);
      const s = await tenant.getSchedule(req.params.id);
      if (!s) return reply.code(404).send({ error: "not_found" });
      if (req.body.cron && !cron.validate(req.body.cron)) {
        return reply.code(400).send({ error: "invalid_cron", message: req.body.cron });
      }
      const updated = await tenant.updateSchedule(req.params.id, {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.cron !== undefined ? { cron: req.body.cron } : {}),
        ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
      });
      if (!updated) return reply.code(404).send({ error: "not_found" });
      scheduler.unregister(req.params.id);
      if (updated.enabled) scheduler.register(updated);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/schedules/:id", async (req, reply) => {
    scheduler.unregister(req.params.id);
    const ok = await tenants.for(req).deleteSchedule(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/schedules/:id/run-now", async (req, reply) => {
    // Confirm the schedule belongs to this tenant before running.
    const s = await tenants.for(req).getSchedule(req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    const result = await scheduler.runOnce(req.params.id);
    return reply.send(result);
  });
}
