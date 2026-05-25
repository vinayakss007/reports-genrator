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
  ai-gateway/     Single chokepoint for AI; falls back to core
```

## Phase 0 quick start

```sh
pnpm install
pnpm build
pnpm dev:api   # http://localhost:3001
pnpm dev:web   # http://localhost:5173
```

`/recommend-chart` works with `AI_ENABLED=false` (the default) and
returns a deterministic ranking from `packages/core`.
