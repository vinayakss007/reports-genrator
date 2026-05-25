# Reports Generator — Requirements

## 1. Vision

A self-serve reports & dashboards builder that supports almost all common
chart and report types over many data sources. The product **must work
end-to-end with AI completely disabled**. AI is an optional, narrowly
scoped sidecar that is never on a hot path.

## 2. In-scope chart and report types (v1+)

Comparison: bar (v/h), grouped bar, stacked bar, 100% stacked bar, column,
lollipop, dot/strip, bullet, radar.

Trend / time-series: line, multi-line, area, stacked area, 100% stacked
area, step line, candlestick/OHLC, sparkline.

Part-to-whole: pie, donut, treemap, sunburst, marimekko, waffle, funnel.

Distribution: histogram, density, box plot, violin, ridgeline, ECDF.

Relationship: scatter, bubble, hex-bin, 2D density, correlation matrix /
heatmap, parallel coordinates.

Hierarchy / flow: tree, dendrogram, sankey, chord, network/graph.

Geo: choropleth, point map, bubble map, heat map, flow map.

Tabular / KPI: pivot table, data grid, KPI tile, gauge, progress bar,
big-number with sparkline.

Composite: dashboards (multi-chart grid), small multiples (faceting),
parameterized reports, drill-through.

Outputs: live web dashboard, PDF, PNG/SVG, XLSX, CSV, scheduled email.

## 3. Functional requirements

FR-1. Users connect a data source (Postgres, MySQL, SQLite, CSV, XLSX,
JSON, REST, S3 — v1 ships Postgres + CSV + XLSX).

FR-2. Users define a Dataset bound to a Source (table, view, or SQL).

FR-3. The system profiles every Dataset deterministically: types,
cardinality, null rate, monotonic-time detection, primary-key candidates,
semantic type hints (currency, percent, id, geo, datetime, ...).

FR-4. Given a Dataset and a set of selected Fields, the system returns a
ranked list of recommended chart types using a **deterministic rule-based
recommender**. This must work with AI disabled and is the system of record.

FR-5. The chart editor lets a user override the recommendation, configure
encodings (x, y, color, size, facet), filters, and aggregations.

FR-6. The aggregation chooser deterministically picks `sum/avg/count/min/
max/median` from rules over data type, cardinality, and distribution.

FR-7. Dashboards compose multiple Reports on a 12-column grid layout with
parameters and filters. Layout is deterministic (greedy bin-packing on add,
free-form drag after).

FR-8. Color palettes are chosen deterministically per data role
(categorical / sequential / diverging) from a token set with WCAG checks.

FR-9. Exports: PDF, PNG, SVG, XLSX, CSV. Scheduling via cron with email or
webhook delivery.

FR-10. RBAC with Org / User / Role; per-Source connection-level
permissions; row-level limits and query timeouts on every read.

FR-11. Anomaly detection (STL + rolling IQR / MAD) and forecasting
(Holt-Winters / ARIMA) are deterministic statistical methods, never AI.

## 4. AI usage policy (binding)

AI is allowed **only** for the following call types, each with a fully
shipped deterministic fallback. AI must never be on a hot path
(no AI on render, no AI on auto-refresh).

- `recommendChart(profile)` — may reorder or annotate the deterministic
  top-K. Fallback: deterministic ranking unchanged.
- `mapFields(profile, target)` — may suggest column-to-slot mapping.
  Fallback: greedy match by name + type.
- `classifySchema(profile)` — may tag a column as `currency | percent |
  id | geo | datetime | ...`. Fallback: regex + heuristic classifier.
- `narrativeInsights(stats)` — may produce 1–3 short bullets summarizing
  a chart. Fallback: deterministic templated bullets.

All AI calls go through a single AI Gateway with:

- Zod-validated JSON-schema responses; invalid → fallback.
- Configurable timeout; exceeded → fallback.
- Env + customer toggles (`AI_ENABLED`, `AI_FEATURES.*`).
- Silent fallback on any failure; no user-visible AI errors.
- Telemetry on fallback rate.

The product must build, run, and pass all smoke tests with `AI_ENABLED=false`.

## 5. Non-functional requirements

- Determinism: same inputs → same outputs for every non-AI code path.
- p95 chart render under 200ms for datasets up to 100k rows after
  server-side aggregation.
- Query timeout default 30s; configurable per Source.
- Row-cap per query default 1M rows server-side; never streamed raw to
  the client.
- Secrets encrypted at rest (KMS or libsodium-sealed).
- Audit log for every Source connect, query, export, schedule, and AI
  call.
- Multi-tenant ready: every row has `org_id`; queries enforce it.

## 6. Out of scope (v1)

- Natural-language to SQL or NL-to-dashboard (forbidden by AI policy).
- AI-driven layout, color, anomaly detection, or forecasting.
- Mobile native apps.
- Real-time streaming sources (Kafka, Kinesis) — batched polling only.

## 7. Acceptance criteria for Phase 0

- Monorepo builds with `pnpm -r build` on a clean checkout.
- `apps/api` exposes `/health` returning 200.
- `apps/api` exposes `/recommend-chart` that accepts a profile and
  returns a deterministic ranked list of chart types.
- `packages/ai-gateway` calls `packages/core` as fallback when
  `AI_ENABLED=false` (the default) and returns identical output to the
  core function.
- `apps/web` renders one screen that calls `/recommend-chart` with a
  sample profile and shows the result.
- CI runs lint + typecheck + build on every push.
