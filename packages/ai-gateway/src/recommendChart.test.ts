import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recommendChart } from "./recommendChart.js";
import { mapFields } from "./mapFields.js";
import { classifySchema } from "./classifySchema.js";
import { narrativeInsights } from "./narrativeInsights.js";

const env = { ...process.env };

beforeEach(() => {
  delete process.env.AI_ENABLED;
  delete process.env.AI_FEATURES_RECOMMEND;
  delete process.env.AI_FEATURES_MAPPING;
  delete process.env.AI_FEATURES_CLASSIFY;
  delete process.env.AI_FEATURES_INSIGHTS;
});
afterEach(() => {
  process.env = { ...env };
});

describe("ai-gateway: recommendChart", () => {
  it("returns core fallback when AI is disabled (default)", async () => {
    const r = await recommendChart({
      fields: [
        { name: "date", type: "datetime", isTemporal: true },
        { name: "revenue", type: "number" },
      ],
    });
    expect(r.source).toBe("core");
    expect(r.fallbackReason).toBe("ai_disabled");
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it("returns feature_disabled when only the recommend toggle is off", async () => {
    process.env.AI_ENABLED = "true";
    process.env.AI_FEATURES_RECOMMEND = "false";
    const r = await recommendChart({
      fields: [
        { name: "x", type: "number" },
        { name: "y", type: "number" },
      ],
    });
    expect(r.source).toBe("core");
    expect(r.fallbackReason).toBe("feature_disabled");
  });

  it("returns ai_disabled when AI on but no provider available", async () => {
    process.env.AI_ENABLED = "true";
    const r = await recommendChart({
      fields: [{ name: "x", type: "number" }],
    });
    expect(r.source).toBe("core");
    expect(r.fallbackReason).toBe("ai_disabled");
  });
});

describe("ai-gateway: mapFields", () => {
  it("falls back to core greedy match", async () => {
    const r = await mapFields({
      fields: [
        { name: "order_date", type: "datetime", role: "time" },
        { name: "revenue", type: "number", role: "measure" },
      ],
      slots: [
        { id: "x", role: "time" },
        { id: "y", role: "measure" },
      ],
    });
    expect(r.source).toBe("core");
    expect(r.assignments.x).toBe("order_date");
    expect(r.assignments.y).toBe("revenue");
  });
});

describe("ai-gateway: classifySchema", () => {
  it("returns deterministic classifications when AI is off", async () => {
    const r = await classifySchema({
      columns: [
        { name: "country", type: "string", values: ["US", "DE", "JP"] },
        { name: "revenue", type: "number", values: [100, 200] },
      ],
    });
    expect(r.source).toBe("core");
    expect(r.classifications.country).toBe("geo_region");
    expect(r.classifications.revenue).toBe("currency");
  });
});

describe("ai-gateway: narrativeInsights", () => {
  it("falls back to templated bullets", async () => {
    const r = await narrativeInsights({
      stats: { field: "revenue", agg: "sum", values: [10, 20, 30, 100], labels: ["Q1", "Q2", "Q3", "Q4"] },
    });
    expect(r.source).toBe("core");
    expect(r.bullets.length).toBeGreaterThan(0);
    expect(r.bullets.length).toBeLessThanOrEqual(3);
  });
});
