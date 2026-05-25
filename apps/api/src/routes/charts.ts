import type { FastifyInstance } from "fastify";
import {
  ChartComputeRequestSchema,
  type ChartType,
} from "@reports/shared";
import {
  autoEncode,
  detectAnomalies,
  holtWinters,
  pickColors,
  decompose,
} from "@reports/core";
import type { Storage } from "@reports/storage";
import { runPreview } from "../preview.js";
import { computeChart } from "../charts.js";

/**
 * Chart computation routes.
 *
 *   POST /charts/auto-encode  - given a Profile + chart, return a
 *       deterministic ChartSpec by filling encoding slots.
 *   POST /charts/compute      - apply a ChartSpec (filters + aggregate)
 *       to provided rows, return shaped rows + computed colors.
 *   POST /charts/series-stats - run STL + anomaly + Holt-Winters on a
 *       numeric series. Used for time-series overlays in the renderer.
 *
 * All deterministic. AI never touches these paths.
 */
export function registerChartRoutes(app: FastifyInstance, storage: Storage): void {
  app.post("/charts/auto-encode", async (req, reply) => {
    const body = req.body as {
      profile?: unknown;
      chart?: ChartType;
      maxMeasures?: number;
    };
    if (!body || !body.chart) {
      return reply.code(400).send({ error: "missing_chart" });
    }
    const profile = body.profile as Parameters<typeof autoEncode>[0];
    if (!profile?.fields) {
      return reply.code(400).send({ error: "missing_profile" });
    }
    return reply.send(autoEncode(profile, body.chart, { maxMeasures: body.maxMeasures }));
  });

  app.post("/charts/compute", async (req, reply) => {
    const parsed = ChartComputeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { spec, rows } = parsed.data;

    let resolvedRows = rows;
    // Optional: if a datasetId was passed AND rows is empty, resolve.
    if (parsed.data.datasetId && resolvedRows.length === 0) {
      const ds = await storage.getDataset(parsed.data.datasetId);
      if (!ds) return reply.code(404).send({ error: "dataset_not_found" });
      const src = await storage.getSource(ds.sourceId);
      if (!src) return reply.code(404).send({ error: "source_not_found" });
      const pv = await runPreview(storage, src, ds, 10_000);
      resolvedRows = pv.rows;
    }

    const computed = computeChart(resolvedRows, spec);

    // Deterministic colors keyed by the color encoding's distinct values.
    const enc = spec.encoding;
    let colors: string[] = [];
    if (enc.color && !enc.color.agg) {
      const distinct = uniqueValues(computed.rows, enc.color.field);
      colors = pickColors({ kind: "categorical", count: distinct.length }).colors;
    } else {
      const yLen = Array.isArray(enc.y) ? enc.y.length : enc.y ? 1 : 1;
      colors = pickColors({ kind: "categorical", count: yLen }).colors;
    }

    return reply.send({ ...computed, colors, spec });
  });

  app.post("/charts/series-stats", async (req, reply) => {
    const body = req.body as {
      values?: number[];
      labels?: string[];
      period?: number;
      horizon?: number;
      anomalyWindow?: number;
      anomalyK?: number;
    };
    if (!body || !Array.isArray(body.values)) {
      return reply.code(400).send({ error: "missing_values" });
    }
    const values: number[] = body.values
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    if (values.length < 4) {
      return reply.code(400).send({ error: "too_few_points", message: "need at least 4 points" });
    }
    const period = body.period && body.period > 1 ? Math.floor(body.period) : 0;
    const horizon = body.horizon ? Math.floor(body.horizon) : 12;

    const decomp = decompose(values, { period });
    const anomalies = detectAnomalies(values, {
      window: body.anomalyWindow ?? 24,
      k: body.anomalyK ?? 3.5,
    });
    const fc = holtWinters(values, { period, horizon });

    return reply.send({
      labels: body.labels,
      values,
      decomposition: decomp,
      anomalies,
      forecast: fc,
    });
  });
}

function uniqueValues(rows: readonly Record<string, unknown>[], field: string): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const r of rows) {
    const v = r[field];
    const key = String(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
