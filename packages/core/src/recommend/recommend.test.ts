import { describe, it, expect } from "vitest";
import { recommendChart } from "./recommend.js";
import type { Profile } from "@reports/shared";

describe("recommendChart", () => {
  it("recommends line at the top for time + measure", () => {
    const p: Profile = {
      fields: [
        { name: "order_date", type: "datetime", isTemporal: true },
        { name: "revenue", type: "number" },
      ],
    };
    const result = recommendChart(p);
    expect(result[0]?.chart).toBe("line");
    expect(result.map((r) => r.chart)).toContain("area");
  });

  it("recommends choropleth for geo region + measure", () => {
    const p: Profile = {
      fields: [
        { name: "country", type: "geo", semantic: "geo_region", isGeo: true },
        { name: "users", type: "integer" },
      ],
      intent: "geo",
    };
    const result = recommendChart(p);
    expect(result[0]?.chart).toBe("choropleth");
  });

  it("recommends pie only for low-cardinality dim with part-to-whole intent", () => {
    const lowCard: Profile = {
      fields: [
        { name: "channel", type: "string", cardinality: 4 },
        { name: "revenue", type: "number" },
      ],
      intent: "part_to_whole",
    };
    const result = recommendChart(lowCard);
    expect(result.map((r) => r.chart)).toContain("pie");

    const highCard: Profile = {
      fields: [
        { name: "channel", type: "string", cardinality: 50 },
        { name: "revenue", type: "number" },
      ],
      intent: "part_to_whole",
    };
    const high = recommendChart(highCard);
    expect(high.map((r) => r.chart)).not.toContain("pie");
  });

  it("recommends scatter for two measures, no time", () => {
    const p: Profile = {
      fields: [
        { name: "ad_spend", type: "number" },
        { name: "revenue", type: "number" },
      ],
    };
    const r = recommendChart(p);
    expect(r[0]?.chart).toBe("scatter");
  });

  it("is deterministic: same input -> same output", () => {
    const p: Profile = {
      fields: [
        { name: "month", type: "string", cardinality: 12 },
        { name: "sales", type: "number" },
        { name: "region", type: "string", cardinality: 4 },
      ],
    };
    const a = recommendChart(p);
    const b = recommendChart(p);
    expect(a).toEqual(b);
  });

  it("falls back to table when no rule matches", () => {
    const p: Profile = { fields: [{ name: "id", type: "string", role: "id" }] };
    const r = recommendChart(p);
    expect(r[0]?.chart).toBe("table");
  });
});
