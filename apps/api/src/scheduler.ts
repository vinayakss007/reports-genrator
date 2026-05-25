import { promises as fs, createWriteStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import type { Storage, StoredSchedule } from "@reports/storage";
import type { ExportTarget } from "@reports/shared";
import { runExport } from "./exports.js";

/**
 * In-process scheduler.
 *
 * Reads schedules from storage at startup, registers a `node-cron` job
 * for each enabled one, and on tick runs the export to either a
 * webhook (HTTP POST of the export bytes) or a file under
 * `${DATA_DIR}/exports/<dir>/<id>.<ext>`. Real, no fakes.
 *
 * Why node-cron and not BullMQ here? BullMQ is the right choice when
 * the deployment is multi-process or HA; for the single-process v1
 * deployment node-cron is a real, in-tree cron runner. The
 * `Scheduler` API is the seam to swap for BullMQ later without
 * touching callers.
 */
export class Scheduler {
  private readonly tasks = new Map<string, cron.ScheduledTask>();

  constructor(
    private readonly storage: Storage,
    private readonly logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
  ) {}

  /** Register all enabled schedules from storage. */
  async start(): Promise<void> {
    const all = await this.storage.listSchedules();
    for (const s of all) {
      if (s.enabled) this.register(s);
    }
  }

  /** Stop every registered task. Idempotent. */
  stop(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }

  /** Add or replace the cron job for a schedule. */
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
   * Run a schedule's export and deliver it. Updates the schedule's
   * lastRunAt / lastStatus / lastMessage fields. Real network call
   * for webhook delivery; real disk write for file delivery.
   */
  async runOnce(id: string): Promise<{ ok: boolean; message: string }> {
    const sched = await this.storage.getSchedule(id);
    if (!sched) return { ok: false, message: "not_found" };

    let result: { ok: boolean; message: string };
    try {
      const target = sched.target as ExportTarget;
      result = await this.deliver(sched, target);
    } catch (err) {
      result = { ok: false, message: (err as Error).message };
    }

    await this.storage.updateSchedule(id, {
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
    if (sched.delivery.kind === "webhook") {
      // Run the export to a buffer, then POST to the URL. We deliberately
      // buffer (rather than streaming through fetch) so we can compute a
      // content-length and surface delivery failures atomically.
      const chunks: Buffer[] = [];
      const out = new (await import("node:stream")).PassThrough();
      out.on("data", (c: Buffer) => chunks.push(c));
      const finished = new Promise<void>((resolve, reject) => {
        out.on("end", resolve);
        out.on("error", reject);
      });
      const meta = await runExport({
        storage: this.storage,
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
      if (!res.ok) {
        return { ok: false, message: `webhook ${res.status}` };
      }
      return { ok: true, message: `delivered ${body.length} bytes to webhook (HTTP ${res.status})` };
    }

    // file delivery
    const dir = join(this.storage.root, "exports", sched.delivery.dir);
    await fs.mkdir(dir, { recursive: true });
    const ext = sched.format;
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.${ext}`;
    const path = join(dir, filename);
    const ws = createWriteStream(path, { flags: "wx", mode: 0o600 });
    try {
      await runExport({ storage: this.storage, format: sched.format, target, out: ws });
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
