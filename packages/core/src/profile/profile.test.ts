import { describe, it, expect } from "vitest";
import { profileRows, primaryKeyCandidates } from "./profile.js";
import { detectValueType, widenType, isNullish } from "./detect.js";
import { isMonotonicTime } from "./monotonic.js";

describe("detectValueType", () => {
  it("classifies primitives correctly", () => {
    expect(detectValueType(true)).toBe("boolean");
    expect(detectValueType(42)).toBe("integer");
    expect(detectValueType(3.14)).toBe("number");
    expect(detectValueType("123")).toBe("integer");
    expect(detectValueType("3.14")).toBe("number");
    expect(detectValueType("2024-01-15")).toBe("date");
    expect(detectValueType("2024-01-15T10:00:00Z")).toBe("datetime");
    expect(detectValueType(new Date("2024-01-15"))).toBe("datetime");
    expect(detectValueType("hello")).toBe("string");
  });

  it("isNullish covers blanks, NA, NULL", () => {
    expect(isNullish(null)).toBe(true);
    expect(isNullish(undefined)).toBe(true);
    expect(isNullish("")).toBe(true);
    expect(isNullish("  ")).toBe(true);
    expect(isNullish("NA")).toBe(true);
    expect(isNullish("NULL")).toBe(true);
    expect(isNullish("0")).toBe(false);
    expect(isNullish(0)).toBe(false);
  });
});

describe("widenType", () => {
  it("widens numeric pair to number", () => {
    expect(widenType("integer", "number")).toBe("number");
    expect(widenType("number", "integer")).toBe("number");
  });
  it("widens date pair to datetime", () => {
    expect(widenType("date", "datetime")).toBe("datetime");
  });
  it("falls back to string when types differ", () => {
    expect(widenType("integer", "string")).toBe("string");
  });
  it("unknown is identity", () => {
    expect(widenType("unknown", "integer")).toBe("integer");
    expect(widenType("integer", "unknown")).toBe("integer");
  });
});

describe("isMonotonicTime", () => {
  it("flags strictly increasing date strings", () => {
    expect(
      isMonotonicTime(["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]),
    ).toBe(true);
  });
  it("rejects shuffled dates", () => {
    expect(
      isMonotonicTime(["2024-03-01", "2024-01-01", "2024-02-01", "2024-04-01"]),
    ).toBe(false);
  });
  it("requires at least 4 valid points", () => {
    expect(isMonotonicTime(["2024-01-01", "2024-02-01"])).toBe(false);
  });
});

describe("profileRows", () => {
  it("computes types, cardinality, and null rate", () => {
    const rows = [
      { id: 1, name: "alice", date: "2024-01-15", revenue: 100.5 },
      { id: 2, name: "bob", date: "2024-02-15", revenue: 200 },
      { id: 3, name: null, date: "2024-03-15", revenue: 300 },
    ];
    const p = profileRows(["id", "name", "date", "revenue"], rows);
    expect(p.rowCount).toBe(3);
    const byName = Object.fromEntries(p.fields.map((f) => [f.name, f]));
    expect(byName.id?.type).toBe("integer");
    expect(byName.name?.cardinality).toBe(2);
    expect(byName.name?.nullRate).toBeCloseTo(1 / 3);
    expect(byName.date?.isTemporal).toBe(true);
    expect(byName.revenue?.semantic).toBe("currency");
  });

  it("does NOT flag sequential integer ids as temporal (regression)", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      customer_id: 1000 + i,
      name: `c${i}`,
    }));
    const p = profileRows(["customer_id", "name"], rows);
    const f = p.fields.find((x) => x.name === "customer_id");
    expect(f?.isTemporal).toBe(false);
  });

  it("primaryKeyCandidates finds unique non-null columns", () => {
    const rows = [
      { id: 1, kind: "a" },
      { id: 2, kind: "b" },
      { id: 3, kind: "a" },
    ];
    const p = profileRows(["id", "kind"], rows);
    const pk = primaryKeyCandidates(p);
    expect(pk).toEqual(["id"]);
  });
});
