# Reports Generator — Task Plan

Phases are sequential; tasks within a phase can be parallelized.

## Phase 0 — Skeleton (this PR)

- [x] Spec docs and AI policy steering file.
- [x] pnpm workspace root, tsconfig base, .gitignore, .editorconfig.
- [x] `packages/shared` with core types and Zod schemas.
- [x] `packages/core` with a real deterministic chart recommender.
- [x] `packages/ai-gateway` with toggle, timeout, Zod validation, silent
      fallback to `core`. Default `AI_ENABLED=false`.
- [x] `apps/api`: Fastify with `/health` and `/recommend-chart`.
- [x] `apps/web`: Vite + React page calling `/recommend-chart`.
- [x] CI: lint + typecheck + build.

## Phase 1 — Core data plane

- [x] Source connectors: Postgres, CSV, XLSX. Real implementations
      using `pg`, `papaparse`, and `exceljs`.
- [x] Schema profiler with type, cardinality, null rate, monotonic-time,
      PK candidate detection. Pure deterministic functions in
      `packages/core/src/profile/`.
- [x] Dataset preview API (`POST /datasets/:id/preview`) returning
      rows + computed profile. Output is exactly the shape consumed
      by `POST /recommend-chart`.
- [x] Encrypted secret storage for source credentials using
      XChaCha20-Poly1305 with a per-data-dir key (or
      `STORAGE_ENCRYPTION_KEY` env override).
- [x] File uploads via `@fastify/multipart` (`POST /uploads`),
      stored at `${DATA_DIR}/uploads/<id>.<ext>` with 0600 perms.
- [x] Web UI: single workflow page that runs the full pipeline —
      upload (or PG connect) → source → dataset → preview → recommend.

## Phase 2 — Deterministic chart engine

- [x] Aggregation chooser (`sum/avg/count/count_distinct/min/max/median`).
- [x] Filter predicate engine with 14 ops (eq/neq/gt/gte/lt/lte/in/nin/
      contains/starts_with/ends_with/is_null/is_not_null/between).
- [x] Rule recommender expanded (already complete in Phase 0; covers
      all chart types in `ChartType`).
- [x] Auto-encoder: deterministic Profile + ChartType -> ChartSpec
      with encoding slots filled from field roles + cardinality.
- [x] Color palettes (categorical 8/16, sequential blue/green,
      diverging rdbu) + WCAG contrast ratio.
- [x] ECharts renderer covering ~25 chart types: line, multi_line,
      area, stacked_area, step_line, sparkline, bar, column,
      lollipop, grouped_bar, stacked_bar, stacked_bar_100, pie,
      donut, funnel, scatter, bubble, histogram, box, heatmap,
      correlation_matrix, treemap, sunburst, sankey, radar,
      candlestick, gauge, progress, parallel_coordinates.
- [x] Chart editor: chart-type picker (recommended + full catalog),
      encoding slot pickers with per-slot agg, multi-measure support,
      filter rows, top-N limit.

## Phase 3 — Dashboards and exports

- Dashboard model, 12-col grid layout, parameters, cross-filters.
- Exports: PDF (Playwright), PNG/SVG, XLSX (exceljs), CSV.
- Schedules: cron + email/webhook via BullMQ + Redis.

## Phase 4 — Extended chart types

- [x] Treemap, sunburst, sankey, candlestick, radar, parallel
      coordinates landed with the Phase 2 renderer.
- Geo (choropleth, point map, bubble map) — chart types are wired
  into the recommender and encoder; ECharts geo support requires
  bundling map JSON. Renderer falls back to a generic xy view in
  this PR; full geo rendering belongs to a follow-up alongside
  map data acquisition.
- Pivot table — encoded; renders via the heatmap/heatmap-table
  for now; a dedicated pivot grid component is a Phase 3 follow-up.

## Phase 5 — AI sidecar

- [x] All four allowed AI calls plumbed through the gateway with
      identical discipline (toggle, timeout, Zod, silent fallback,
      telemetry): `recommendChart`, `mapFields`, `classifySchema`,
      `narrativeInsights`. Deterministic fallbacks live in
      `packages/core/{recommend,mapping,classify,insights}`.
- Real provider adapters (OpenAI / Anthropic / Bedrock) — the
  gateway exposes a provider interface but no adapter is wired.
  Adding one is a contained change behind feature flags; the
  product will continue to function unchanged when AI is off.

## Phase 6 — Anomaly and forecasting

- [x] STL-style additive decomposition (centered moving-average
      trend + per-phase seasonal mean) in `packages/core/stats/stl`.
- [x] Rolling MAD anomaly detection with robust z-scores.
- [x] Holt-Winters triple-exponential smoothing with seasonal init,
      falling back to Holt linear when period < 2 or n < 2*period.
- [x] Wired into the renderer as anomaly dots + dashed forecast
      line on time-series charts.

## Phase 7 — Hardening

- RBAC, audit log, rate limits, query timeouts, row caps.
- Secret rotation, KMS integration.
- Multi-tenant `org_id` enforcement audit.
