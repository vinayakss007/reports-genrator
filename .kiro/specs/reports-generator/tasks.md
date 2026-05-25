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

- [x] Dashboard data model: `Dashboard { name, parameters, tiles[]
      with layout {x,y,w,h} on a 12-col grid }`. Stored in the
      Phase 1 JSON store with v1 -> v2 migration.
- [x] Dashboard CRUD: POST/GET/PUT/DELETE `/dashboards`.
- [x] Multi-tile dashboard view in the web app using
      `react-grid-layout` with drag and resize, persisted via PUT.
- [x] Dashboard parameters merged into every tile's filter list at
      compute time, giving real cross-filtering across tiles.
- [x] Server-side exports: `POST /exports` and `POST /exports/save`
      for CSV (RFC 4180), XLSX (multi-sheet via ExcelJS), and JSON.
      Targets: dataset, chart, dashboard.
- [x] Frontend exports: PNG and SVG via ECharts'
      `getDataURL()`/data-URI wrapping; CSV/XLSX/JSON via the API.
- [x] Schedules: data model + CRUD + in-process `node-cron` runner.
      Real webhook delivery (HTTP POST of the export bytes with
      content-type and disposition headers); real file delivery
      (writes to `${DATA_DIR}/exports/<dir>/<timestamp>-<id>.<ext>`).
      `lastRunAt`, `lastStatus`, `lastMessage` persisted.
- [x] Web UI: Schedules page (create / list / enable / run-now / delete)
      and dashboard list / view tabs alongside Build.
- SMTP email delivery — deferred. The mechanism is contained to a
  new delivery kind under `Schedule.delivery`; adding nodemailer
  with `SMTP_*` env vars is small but un-testable in this sandbox.
- PDF rendering — deferred. The print path (CSS `@media print`)
  works today via the browser; server-side PDF rendering needs a
  headless browser, which is heavy to install and out of scope here.
- Redis-backed BullMQ — out of scope for v1 single-process
  deployment. The `Scheduler` API is the seam to swap in a queue
  without changing callers.

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

- [x] Tests: vitest workspace at root with **58 unit tests** across the
      deterministic engine, AI gateway fallback discipline, exports
      writers, and tenant isolation.
- [x] Audit log: append-only JSONL at `${DATA_DIR}/audit.log` with
      0600 perms. Records auth events and every non-GET request.
- [x] Rate limiting: `@fastify/rate-limit` (default 300 req/min).
- [x] Authentication: `@fastify/jwt` with `bcryptjs` cost-10 hashes,
      JWT secret persisted at `${DATA_DIR}/.jwt-secret` (or via
      `JWT_SECRET` env). Routes: `POST /auth/register`,
      `POST /auth/login`, `GET /auth/me`. Roles: owner/editor/viewer.
- [x] AUTH_REQUIRED env flag toggles enforcement on every route
      except `/health` and `/auth/*`.
- [x] **Multi-tenant org_id rollout**: every Stored* record carries
      an `orgId`. JsonStore migrates v1/v2/v3 → v4 by assigning
      orphan records to a default org. `Storage.forOrg(orgId)`
      returns a `TenantStorage` whose every list/get/create/delete
      is org-scoped; cross-org access returns null/false. Routes
      use a `TenantResolver` that takes `req.principal.orgId`
      under AUTH_REQUIRED, otherwise the boot-time default org.
      Scheduler reads `orgId` from each schedule and runs inside
      `storage.forOrg(orgId)`. Five tenant-isolation tests verify
      the boundary (incl. v3 → v4 migration).
- KMS / secret rotation — `JWT_SECRET` and `STORAGE_ENCRYPTION_KEY`
  env vars are the swap seam; KMS adapter is a follow-up.
