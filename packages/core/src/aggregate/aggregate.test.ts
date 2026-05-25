import { describe, it, expect } from "vitest";
import { aggregate, chooseAgg } from "./aggregate.js";
import { applyFilters } from "./filter.js";

describe("aggregate", () => {
  const rows = [
    { region: "East", product: "W", units: 10, revenue: 100 },
    { region: "East", product: "W", units: 5, revenue: 50 },
    { region: "West", product: "W", units: 8, revenue: 80 },
    { region: "West", product: "G", units: 3, revenue: 30 },
    { region: "East", product: "G", units: 7, revenue: 70 },
  ];

  it("groups and sums", () => {
    const r = aggregate(rows, {
      groupBy: ["region"],
      measures: [{ field: "revenue", fn: "sum" }],
    });
    expect(r.columns).toEqual(["region", "sum_revenue"]);
    const byRegion = Object.fromEntries(r.rows.map((x) => [x.region, x.sum_revenue]));
    expect(byRegion.East).toBe(220);
    expect(byRegion.West).toBe(110);
  });

  it("supports multiple aggregations", () => {
    const r = aggregate(rows, {
      groupBy: ["region"],
      measures: [
        { field: "revenue", fn: "sum" },
        { field: "units", fn: "avg" },
        { field: "*", fn: "count" },
      ],
    });
    const east = r.rows.find((x) => x.region === "East");
    expect(east?.sum_revenue).toBe(220);
    expect(east?.avg_units).toBeCloseTo((10 + 5 + 7) / 3);
    expect(east?.count).toBe(3);
  });

  it("count_distinct returns distinct count", () => {
    const r = aggregate(rows, {
      groupBy: ["region"],
      measures: [{ field: "product", fn: "count_distinct" }],
    });
    const east = r.rows.find((x) => x.region === "East");
    expect(east?.count_distinct_product).toBe(2);
  });

  it("median works", () => {
    const r = aggregate(rows, {
      groupBy: ["region"],
      measures: [{ field: "units", fn: "median" }],
    });
    const east = r.rows.find((x) => x.region === "East");
    expect(east?.median_units).toBe(7);
  });

  it("output is deterministic across runs", () => {
    const a = aggregate(rows, {
      groupBy: ["region", "product"],
      measures: [{ field: "revenue", fn: "sum" }],
    });
    const b = aggregate(rows, {
      groupBy: ["region", "product"],
      measures: [{ field: "revenue", fn: "sum" }],
    });
    expect(a.rows).toEqual(b.rows);
  });

  it("respects sort and limit (top-N)", () => {
    const r = aggregate(rows, {
      groupBy: ["region"],
      measures: [{ field: "revenue", fn: "sum" }],
      sort: [{ field: "sum_revenue", dir: "desc" }],
      limit: 1,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.region).toBe("East");
  });
});

describe("chooseAgg", () => {
  it("picks sum for currency / measure", () => {
    expect(
      chooseAgg({ name: "revenue", type: "number", semantic: "currency", role: "measure" }),
    ).toBe("sum");
  });
  it("picks avg for percent", () => {
    expect(
      chooseAgg({ name: "rate", type: "number", semantic: "percent", role: "measure" }),
    ).toBe("avg");
  });
  it("picks count_distinct for id", () => {
    expect(chooseAgg({ name: "user_id", type: "integer", semantic: "id" })).toBe("count_distinct");
  });
  it("picks count for strings", () => {
    expect(chooseAgg({ name: "x", type: "string" })).toBe("count");
  });
});

describe("applyFilters", () => {
  const rows = [
    { region: "East", units: 10, name: "Widget" },
    { region: "West", units: 5, name: "Gadget" },
    { region: "East", units: 12, name: "Gizmo" },
    { region: "South", units: 3, name: null },
  ];
  it("eq", () => {
    expect(applyFilters(rows, [{ field: "region", op: "eq", value: "East" }])).toHaveLength(2);
  });
  it("gt + AND combine", () => {
    const r = applyFilters(rows, [
      { field: "region", op: "eq", value: "East" },
      { field: "units", op: "gt", value: 10 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.units).toBe(12);
  });
  it("in / nin", () => {
    expect(applyFilters(rows, [{ field: "region", op: "in", values: ["East", "West"] }])).toHaveLength(3);
    expect(applyFilters(rows, [{ field: "region", op: "nin", values: ["East"] }])).toHaveLength(2);
  });
  it("contains / starts_with / ends_with", () => {
    expect(applyFilters(rows, [{ field: "name", op: "contains", value: "iz" }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: "name", op: "starts_with", value: "G" }])).toHaveLength(2);
    expect(applyFilters(rows, [{ field: "name", op: "ends_with", value: "et" }])).toHaveLength(2);
  });
  it("is_null / is_not_null", () => {
    expect(applyFilters(rows, [{ field: "name", op: "is_null" }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: "name", op: "is_not_null" }])).toHaveLength(3);
  });
  it("between (inclusive)", () => {
    expect(applyFilters(rows, [{ field: "units", op: "between", range: [5, 10] }])).toHaveLength(2);
  });
});
