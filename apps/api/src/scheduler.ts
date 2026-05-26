import { promises as fs, createWriteStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import type { Storage, StoredSchedule } from "@reports/storage";
import type { ExportTarget } from "@reports/shared";
import { runExport } from "./exports.js";
import { sendEmail, isSmtpConfigured } from "./email.js";

/**
 * In-process scheduler.
 *
 * Schedules carry their own orgId. On each tick the runner loads the
 * schedule, scopes a TenantStorage to that orgId, and routes the
 * export through the same pipeline used by request handlers. There is
 * no path to cross-tenant data here.
 */
export class Scheduler {
  private readonly tasks = new Map<string, cron.ScheduledTask>();

  constructor(
    private readonly storage: Storage,
    private readonly logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
  ) {}

  /** Register all enabled schedules across every org. */
  async start(): Promise<void> {
    const all = await this.storage.listAllSchedules();
    for (const s of all) if (s.enabled) this.register(s);
  }

  stop(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }

  register(s: StoredSchedule): void {
    this.unregister(s.id);
    if (!s.enabled) return;
    if (!cron.validate(s.cron)) {
      this.logger.error(`schedule ${s.id} has invalid cron: ${s.cron}`);
      return;
    }
    const task = cron.schedule(
      s.cron,
      () => {
        void this.runOnce(s.id).catch((err) => {
          this.logger.error(`schedule ${s.id} run failed`, err);
        });
      },
      { scheduled: true },
    );
    this.tasks.set(s.id, task);
    this.logger.info(`scheduled ${s.name} (${s.id}) on ${s.cron}`);
  }

  unregister(id: string): void {
    const t = this.tasks.get(id);
    if (t) {
      t.stop();
      this.tasks.delete(id);
    }
  }

  /**
   * Run a schedule once and persist its lastRunAt/lastStatus/
   * lastMessage. The schedule is looked up across every org (because
   * the runner has no request context); the export pipeline then runs
   * inside the schedule's own org via storage.forOrg(orgId).
   */
  async runOnce(id: string): Promise<{ ok: boolean; message: string }> {
    const sched = await this.storage.getScheduleAnywhere(id);
    if (!sched) return { ok: false, message: "not_found" };

    let result: { ok: boolean; message: string };
    try {
      const target = sched.target as ExportTarget;
      result = await this.deliver(sched, target);
    } catch (err) {
      result = { ok: false, message: (err as Error).message };
    }

    await this.storage.updateScheduleAnywhere(id, {
      lastRunAt: new Date().toISOString(),
      lastStatus: result.ok ? "ok" : "error",
      lastMessage: result.message.slice(0, 2000),
    });
    return result;
  }

  private async deliver(
    sched: StoredSchedule,
    target: ExportTarget,
  ): Promise<{ ok: boolean; message: string }> {
    const tenant = this.storage.forOrg(sched.orgId);

    if (sched.delivery.kind === "webhook") {
      const chunks: Buffer[] = [];
      const out = new (await import("node:stream")).PassThrough();
      out.on("data", (c: Buffer) => chunks.push(c));
      const finished = new Promise<void>((resolve, reject) => {
        out.on("end", resolve);
        out.on("error", reject);
      });
      const meta = await runExport({
        tenant,
        format: sched.format,
        target,
        out,
      });
      out.end();
      await finished;
      const body = Buffer.concat(chunks);
      const res = await fetch(sched.delivery.url, {
        method: "POST",
        headers: {
          "content-type": meta.contentType,
          "content-disposition": `attachment; filename="${meta.filename}"`,
          ...sched.delivery.headers,
        },
        body,
      });
      if (!res.ok) return { ok: false, message: `webhook ${res.status}` };
      return { ok: true, message: `delivered ${body.length} bytes to webhook (HTTP ${res.status})` };
    }

    if (sched.delivery.kind === "email") {
      if (!isSmtpConfigured()) {
        return { ok: false, message: "SMTP_HOST not configured" };
      }
      const chunks: Buffer[] = [];
      const out = new (await import("node:stream")).PassThrough();
      out.on("data", (c: Buffer) => chunks.push(c));
      const finished = new Promise<void>((resolve, reject) => {
        out.on("end", resolve);
        out.on("error", reject);
      });
      const meta = await runExport({ tenant, format: sched.format, target, out });
      out.end();
      await finished;
      const body = Buffer.concat(chunks);
      await sendEmail({
        to: sched.delivery.to,
        subject: sched.delivery.subject ?? `Scheduled export: ${sched.name}`,
        text: `Attached: ${meta.filename} (${body.length} bytes)`,
        attachments: [
          { filename: meta.filename, content: body, contentType: meta.contentType },
        ],
      });
      return { ok: true, message: `emailed ${body.length} bytes to ${sched.delivery.to}` };
    }

    // file delivery
    const dir = join(this.storage.root, "exports", sched.orgId, sched.delivery.dir);
    await fs.mkdir(dir, { recursive: true });
    const ext = sched.format;
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.${ext}`;
    const path = join(dir, filename);
    const ws = createWriteStream(path, { flags: "wx", mode: 0o600 });
    try {
      await runExport({ tenant, format: sched.format, target, out: ws });
      await new Promise<void>((resolve, reject) => {
        ws.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
      });
      const stat = await fs.stat(path);
      return { ok: true, message: `wrote ${stat.size} bytes to ${path}` };
    } catch (err) {
      ws.destroy();
      await fs.unlink(path).catch(() => undefined);
      throw err;
    }
  }
}
