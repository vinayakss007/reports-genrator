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

- Aggregation chooser (`sum/avg/count/min/max/median`).
- Rule recommender expanded to full rule set in design §5.
- ECharts renderer covering: bar, column, line, area, pie, donut, scatter,
  histogram, box, heatmap, treemap, KPI, table.
- Filters and basic encodings (x, y, color, size, facet).

## Phase 3 — Dashboards and exports

- Dashboard model, 12-col grid layout, parameters, cross-filters.
- Exports: PDF (Playwright), PNG/SVG, XLSX (exceljs), CSV.
- Schedules: cron + email/webhook via BullMQ + Redis.

## Phase 4 — Extended chart types

- Sankey, chord, sunburst, candlestick, radar.
- Geo: choropleth, point map, bubble map.
- Small multiples / faceting, pivot table.

## Phase 5 — AI sidecar (optional)

- Wire the four allowed AI calls through the gateway with provider
  adapters.
- Customer + env toggles, telemetry, fallback-rate dashboard.
- Smoke test that the product is unchanged when AI is disabled.

## Phase 6 — Anomaly and forecasting

- STL decomposition + rolling IQR / MAD anomaly band.
- Holt-Winters / ARIMA forecast overlay.
- Both deterministic, never AI.

## Phase 7 — Hardening

- RBAC, audit log, rate limits, query timeouts, row caps.
- Secret rotation, KMS integration.
- Multi-tenant `org_id` enforcement audit.
