import { useEffect, useMemo, useState } from "react";
import type {
  AggFn,
  ChartSpec,
  Filter,
  FilterOp,
  Profile,
  SlotField,
} from "./types.js";

/**
 * Chart editor.
 *
 *  - Pick a chart type from the recommended list (or the full catalog).
 *  - Map fields to encoding slots. Slots shown depend on the chart type.
 *  - Choose aggregation per measure slot (default from chooseAgg).
 *  - Add row filters. AND-combined.
 *  - Limit and sort.
 *
 * Pure presentational: it builds a ChartSpec and notifies the parent.
 * Editing the spec re-runs /charts/compute on the parent's clock.
 */
export interface EditorProps {
  profile: Profile;
  /** Top-N recommended charts from /recommend-chart. */
  recommendations: Array<{ chart: string; score: number; reason: string }>;
  /** Initial spec, typically from /charts/auto-encode. */
  initialSpec: ChartSpec;
  onChange: (spec: ChartSpec) => void;
}

const ALL_AGG: AggFn[] = ["sum", "avg", "count", "count_distinct", "min", "max", "median"];
const ALL_OPS: FilterOp[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "nin",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
  "between",
];

const SLOTS_BY_CHART: Record<string, Array<keyof ChartSpec["encoding"]>> = {
  line: ["x", "y", "color"],
  multi_line: ["x", "y", "color"],
  area: ["x", "y", "color"],
  stacked_area: ["x", "y", "color"],
  step_line: ["x", "y", "color"],
  sparkline: ["x", "y"],
  bar: ["x", "y", "color"],
  column: ["x", "y", "color"],
  lollipop: ["x", "y"],
  grouped_bar: ["x", "y", "color"],
  stacked_bar: ["x", "y", "color"],
  stacked_bar_100: ["x", "y", "color"],
  pie: ["x", "y"],
  donut: ["x", "y"],
  funnel: ["x", "y"],
  radar: ["y", "color"],
  scatter: ["x", "y", "color", "size"],
  bubble: ["x", "y", "color", "size"],
  histogram: ["x"],
  box: ["x", "y"],
  heatmap: ["x", "y", "color"],
  correlation_matrix: ["x", "y", "color"],
  treemap: ["x", "y", "parent"],
  sunburst: ["x", "y", "parent"],
  sankey: ["source", "target", "y"],
  candlestick: ["x", "y"],
  gauge: ["y"],
  progress: ["y"],
  kpi: ["y"],
  big_number: ["y"],
  parallel_coordinates: ["y"],
  table: ["x", "y", "color"],
};

export function ChartEditor({ profile, recommendations, initialSpec, onChange }: EditorProps) {
  const [spec, setSpec] = useState<ChartSpec>(initialSpec);

  useEffect(() => setSpec(initialSpec), [initialSpec]);
  useEffect(() => onChange(spec), [spec, onChange]);

  const slotsForChart = SLOTS_BY_CHART[spec.chart] ?? ["x", "y", "color"];
  const fieldNames = useMemo(() => profile.fields.map((f) => f.name), [profile]);
  const measureNames = useMemo(
    () =>
      profile.fields
        .filter((f) => f.type === "number" || f.type === "integer")
        .map((f) => f.name),
    [profile],
  );
  const allChartTypes = useMemo(() => {
    const set = new Set<string>(recommendations.map((r) => r.chart));
    for (const k of Object.keys(SLOTS_BY_CHART)) set.add(k);
    return Array.from(set);
  }, [recommendations]);

  const setSlot = (slot: keyof ChartSpec["encoding"], value: SlotField | SlotField[] | undefined) => {
    setSpec((s) => ({ ...s, encoding: { ...s.encoding, [slot]: value } }));
  };

  return (
    <section style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "1.5rem" }}>
      <div>
        <h3 style={{ marginTop: 0 }}>Chart type</h3>
        <select
          value={spec.chart}
          onChange={(e) => setSpec((s) => ({ ...s, chart: e.target.value }))}
          style={{ width: "100%" }}
        >
          {recommendations.length > 0 && (
            <optgroup label="Recommended">
              {recommendations.map((r) => (
                <option key={r.chart} value={r.chart}>
                  {r.chart} (score {r.score.toFixed(2)})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All chart types">
            {allChartTypes
              .filter((c) => !recommendations.some((r) => r.chart === c))
              .sort()
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </optgroup>
        </select>

        <h3>Limits</h3>
        <label style={{ display: "block" }}>
          top N (after agg):{" "}
          <input
            type="number"
            min={1}
            max={1000}
            value={spec.limit ?? ""}
            placeholder="all"
            onChange={(e) =>
              setSpec((s) => ({
                ...s,
                limit: e.target.value === "" ? undefined : Number.parseInt(e.target.value, 10),
              }))
            }
            style={{ width: "100%" }}
          />
        </label>
      </div>

      <div>
        <h3 style={{ marginTop: 0 }}>Encoding</h3>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {slotsForChart.map((slot) => (
            <SlotRow
              key={String(slot)}
              slotName={String(slot)}
              value={spec.encoding[slot] as SlotField | SlotField[] | undefined}
              fields={slot === "y" || slot === "size" ? measureNames : fieldNames}
              setValue={(v) => setSlot(slot, v)}
              isMeasure={slot === "y" || slot === "size"}
              allowMulti={slot === "y"}
            />
          ))}
        </div>

        <h3>Filters</h3>
        <FiltersEditor
          filters={spec.filters ?? []}
          fields={fieldNames}
          setFilters={(filters) => setSpec((s) => ({ ...s, filters }))}
        />
      </div>
    </section>
  );
}

function SlotRow({
  slotName,
  value,
  fields,
  setValue,
  isMeasure,
  allowMulti,
}: {
  slotName: string;
  value: SlotField | SlotField[] | undefined;
  fields: string[];
  setValue: (v: SlotField | SlotField[] | undefined) => void;
  isMeasure: boolean;
  allowMulti: boolean;
}) {
  const single = !Array.isArray(value) ? value : undefined;
  const list = Array.isArray(value) ? value : single ? [single] : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 40px", gap: "0.5rem", alignItems: "center" }}>
      <span style={{ fontWeight: 600 }}>{slotName}</span>

      <select
        value={list[0]?.field ?? ""}
        onChange={(e) => {
          const f = e.target.value;
          if (f === "") return setValue(undefined);
          const next: SlotField = { field: f, agg: list[0]?.agg };
          if (allowMulti && list.length > 1) {
            const arr = list.slice();
            arr[0] = next;
            setValue(arr);
          } else {
            setValue(next);
          }
        }}
      >
        <option value="">(none)</option>
        {fields.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        {isMeasure && <option value="*">* (count)</option>}
      </select>

      {isMeasure ? (
        <select
          value={list[0]?.agg ?? ""}
          onChange={(e) => {
            const agg = (e.target.value || undefined) as AggFn | undefined;
            if (!list[0]) return;
            const next: SlotField = { ...list[0], agg };
            if (allowMulti && list.length > 1) {
              const arr = list.slice();
              arr[0] = next;
              setValue(arr);
            } else setValue(next);
          }}
        >
          <option value="">auto</option>
          {ALL_AGG.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      ) : (
        <span />
      )}

      {allowMulti ? (
        <button
          onClick={() => {
            if (list.length === 0) return;
            const next = list.slice();
            next.push({ field: list[0]!.field });
            setValue(next);
          }}
          title="add another measure"
        >
          +
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function FiltersEditor({
  filters,
  fields,
  setFilters,
}: {
  filters: Filter[];
  fields: string[];
  setFilters: (f: Filter[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {filters.map((f, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 2fr 60px",
            gap: "0.4rem",
            alignItems: "center",
          }}
        >
          <select
            value={f.field}
            onChange={(e) => {
              const next = filters.slice();
              next[i] = { ...f, field: e.target.value };
              setFilters(next);
            }}
          >
            <option value="">(field)</option>
            {fields.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select
            value={f.op}
            onChange={(e) => {
              const next = filters.slice();
              next[i] = { ...f, op: e.target.value as FilterOp };
              setFilters(next);
            }}
          >
            {ALL_OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <input
            placeholder="value"
            value={
              f.values
                ? f.values.join(",")
                : f.value == null
                  ? ""
                  : String(f.value)
            }
            onChange={(e) => {
              const next = filters.slice();
              const v = e.target.value;
              if (f.op === "in" || f.op === "nin") {
                next[i] = {
                  ...f,
                  values: v.split(",").map((s) => s.trim()).filter(Boolean),
                };
              } else {
                next[i] = { ...f, value: v };
              }
              setFilters(next);
            }}
          />
          <button
            onClick={() => setFilters(filters.filter((_, j) => j !== i))}
            title="remove"
          >
            x
          </button>
        </div>
      ))}
      <button
        onClick={() => setFilters([...filters, { field: fields[0] ?? "", op: "eq", value: "" }])}
        style={{ justifySelf: "start" }}
      >
        + filter
      </button>
    </div>
  );
}
