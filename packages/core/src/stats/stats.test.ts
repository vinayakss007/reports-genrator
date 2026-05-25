import { describe, it, expect } from "vitest";
import { decompose, movingAverage } from "./stl.js";
import { detectAnomalies } from "./anomaly.js";
import { holtWinters } from "./forecast.js";

describe("movingAverage", () => {
  it("smooths the series", () => {
    const v = movingAverage([1, 2, 3, 4, 5, 6, 7], 3);
    expect(v).toHaveLength(7);
    expect(v[3]).toBeCloseTo(4);
  });
  it("returns same length as input", () => {
    expect(movingAverage([1, 2, 3], 5)).toHaveLength(3);
  });
});

describe("decompose", () => {
  it("returns trend + seasonal + residual aligned to input length", () => {
    const v = [
      10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
      11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33,
    ];
    const d = decompose(v, { period: 12 });
    expect(d.trend).toHaveLength(v.length);
    expect(d.seasonal).toHaveLength(v.length);
    expect(d.residual).toHaveLength(v.length);
  });
});

describe("detectAnomalies", () => {
  it("flags a clear outlier", () => {
    const v = [10, 11, 9, 10, 12, 11, 9, 10, 11, 9, 10, 1000];
    const out = detectAnomalies(v, { window: 8, k: 3 });
    expect(out[11]?.isAnomaly).toBe(true);
    expect(out[0]?.isAnomaly).toBe(false);
  });

  it("does not over-flag a steady series", () => {
    const v = Array.from({ length: 30 }, (_, i) => 100 + (i % 3));
    const out = detectAnomalies(v, { window: 12, k: 3.5 });
    const anomalies = out.filter((x) => x.isAnomaly);
    expect(anomalies.length).toBe(0);
  });
});

describe("holtWinters", () => {
  it("fits and forecasts a linear trend without seasonality", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = holtWinters(v, { horizon: 3 });
    expect(r.fitted).toHaveLength(10);
    expect(r.forecast).toHaveLength(3);
    expect(r.forecast[0]).toBeGreaterThan(10);
    expect(r.forecast[2]).toBeGreaterThan(r.forecast[0]!);
  });

  it("uses seasonality when n >= 2 * period", () => {
    const period = 4;
    const v: number[] = [];
    for (let t = 0; t < 16; t++) {
      v.push(t + (t % period === 0 ? 5 : 0));
    }
    const r = holtWinters(v, { period, horizon: 4 });
    expect(r.forecast).toHaveLength(4);
    for (const f of r.forecast) expect(Number.isFinite(f)).toBe(true);
  });
});
