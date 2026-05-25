# reports-genrator

A self-serve reports & dashboards builder. Supports a wide catalog of
chart and report types over many data sources. **AI is optional and
never load-bearing** — the product works fully with `AI_ENABLED=false`.

See [`.kiro/specs/reports-generator/`](./.kiro/specs/reports-generator/)
for the full plan:

- [`requirements.md`](./.kiro/specs/reports-generator/requirements.md)
- [`design.md`](./.kiro/specs/reports-generator/design.md)
- [`tasks.md`](./.kiro/specs/reports-generator/tasks.md)
- [`.kiro/steering/ai-policy.md`](./.kiro/steering/ai-policy.md) — binding AI usage policy.

## Layout

```
apps/
  api/            Fastify HTTP API
  web/            Vite + React UI
packages/
  shared/         Types and Zod schemas
  core/           Deterministic engine (no AI, ever)
  connectors/     Real CSV / XLSX / Postgres readers
  storage/        Atomic JSON metadata store + encrypted secrets
  exports/        Real CSV / XLSX / JSON writers
  ai-gateway/     Single chokepoint for AI; falls back to core
```

## Phase 1 quick start

```sh
pnpm install
pnpm build
pnpm dev:api   # http://localhost:3001
pnpm dev:web   # http://localhost:5173
```

Open the web app, upload a CSV/XLSX or connect Postgres, and the
pipeline runs `upload → source → dataset → preview → recommend`. The
preview output is exactly the shape `/recommend-chart` consumes.

### Endpoints

| Method | Path                          | Purpose                       |
|--------|-------------------------------|-------------------------------|
| GET    | `/health`                     | liveness + AI flag            |
| POST   | `/uploads`                    | multipart CSV/XLSX (max 50MB) |
| GET    | `/uploads`                    | list uploaded files           |
| POST   | `/sources`                    | create CSV / XLSX / PG source |
| GET    | `/sources`                    | list sources                  |
| DELETE | `/sources/:id`                | remove source + datasets      |
| POST   | `/datasets`                   | create dataset over a source  |
| GET    | `/datasets`                   | list datasets                 |
| DELETE | `/datasets/:id`               | remove dataset                |
| POST   | `/datasets/:id/preview`       | rows + computed Profile       |
| POST   | `/recommend-chart`            | deterministic chart ranking   |
| POST   | `/charts/auto-encode`         | Profile + chart -> ChartSpec  |
| POST   | `/charts/compute`             | apply spec, return rows + colors |
| POST   | `/charts/series-stats`        | STL + anomalies + Holt-Winters |
| POST   | `/dashboards`                 | create dashboard              |
| GET    | `/dashboards`                 | list dashboards               |
| GET    | `/dashboards/:id`             | get one                       |
| PUT    | `/dashboards/:id`             | update name / params / tiles  |
| DELETE | `/dashboards/:id`             | delete                        |
| POST   | `/exports`                    | run export, stream attachment |
| POST   | `/exports/save`               | run export, save to data/exports |
| GET    | `/exports/:id`                | download a saved export       |
| POST   | `/schedules`                  | create cron schedule          |
| GET    | `/schedules`                  | list schedules                |
| PATCH  | `/schedules/:id`              | enable/disable, rename, recron |
| DELETE | `/schedules/:id`              | delete                        |
| POST   | `/schedules/:id/run-now`      | run a schedule once on demand |

### Environment

`AI_ENABLED=false` is the default — the product works fully without AI.
Set `STORAGE_ENCRYPTION_KEY` to a 32-byte hex value to override the
auto-generated dev key in `${DATA_DIR}/.dev-encryption-key`.
