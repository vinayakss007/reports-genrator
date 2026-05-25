# Reports Generator — Design

## 1. Repository layout

```
reports-genrator/
├── .kiro/
│   ├── specs/reports-generator/{requirements,design,tasks}.md
│   └── steering/ai-policy.md
├── apps/
│   ├── api/            Fastify + TypeScript HTTP API
│   └── web/            Vite + React + TypeScript UI
├── packages/
│   ├── shared/         Shared types and Zod schemas
│   ├── core/           Deterministic engine (no AI, ever)
│   └── ai-gateway/     Single chokepoint for AI; falls back to core
├── package.json        pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .github/workflows/ci.yml
```

## 2. Module boundaries

### `packages/shared`
Pure types and Zod schemas used by every package. No runtime logic. No I/O.

### `packages/core` (deterministic engine)
Stateless, pure functions. Inputs and outputs are plain data. No network.
No AI. No randomness without a seeded RNG. Modules:

- `profile/` — schema profiler (types, cardinality, nulls, monotonic-time).
- `recommend/` — rule-based chart recommender.
- `aggregate/` — aggregation chooser.
- `color/` — palette selector with WCAG check.
- `layout/` — dashboard greedy bin-packer.
- `stats/` — anomaly (STL + IQR/MAD) and forecasting (Holt-Winters).
- `classify/` — semantic-type classifier (regex + heuristic).
- `mapping/` — field-to-slot greedy matcher.
- `insights/` — templated narrative bullets.

### `packages/ai-gateway` (the only place AI is called)
Exports one async function per allowed call type. Every function:

1. Reads env + customer toggles. If disabled → return `core` fallback.
2. Builds a typed prompt and calls the provider through an adapter.
3. Validates the response against a Zod JSON schema.
4. On any of {disabled, timeout, parse error, schema error, provider
   error} → return the `core` fallback. Never throw to callers.
5. Emits a telemetry event with `{call, mode: "ai" | "fallback", reason,
   latencyMs}`.

Provider adapters live behind an interface so the gateway is
provider-agnostic. No AI SDK is imported anywhere outside this package.

### `apps/api`
Fastify with Zod schema validation on every route. Routes for v1:

- `GET /health`
- `POST /recommend-chart` — body: `Profile`; calls `aiGateway.recommendChart`.

Later phases add: `/sources`, `/datasets`, `/reports`, `/dashboards`,
`/exports`, `/schedules`.

### `apps/web`
Vite + React + TS. TanStack Query for server state, Zustand for UI state
(added in later phases). Phase 0 ships one page that POSTs a sample
profile to `/recommend-chart` and renders the result list.

## 3. Data flow for chart recommendation (Phase 0 path)

```
web (sample profile)
   │
   ▼
POST /recommend-chart  (Fastify + Zod request validation)
   │
   ▼
ai-gateway.recommendChart(profile)
   │  AI_ENABLED?
   ├── false ─────────────► core.recommendChart(profile)  ──► response
   │
   └── true
        │
        ├── timeout / schema invalid / provider error
        │      └────────► core.recommendChart(profile)  ──► response
        │
        └── valid AI response
               │
               └─► validated AI list  ──► response
```

The core function is always callable directly. The AI path can only ever
be a thin reorder/annotate of the core ranking.

## 4. Determinism rules

- No `Math.random()` in `packages/core`. Use a seeded RNG when needed.
- All sorts use stable comparators with a final tiebreak on a canonical
  field name.
- All map/object iterations use sorted key order before serialization.
- Time math uses UTC; user time zones are presentation-only.

## 5. Phase 0 chart recommender (rules)

Input: list of `Field` with `{name, type, cardinality, nullRate,
isTemporal, isGeo}` and a target intent (`compare | trend | part_to_whole
| distribution | relationship | hierarchy | geo | kpi | table`). Intent
defaults to `auto` and is inferred from field roles.

Rules (excerpt — full table in `packages/core/src/recommend/rules.ts`):

- 1 numeric measure + 1 temporal dim → `line` (top), `area`, `bar`.
- 1 numeric measure + 1 categorical dim, cardinality ≤ 12 → `bar`,
  `column`, `lollipop`.
- 1 numeric measure + 1 categorical dim, cardinality > 12 → `bar`
  (horizontal, top-N), `treemap`.
- 2 numeric measures → `scatter`, `bubble` (if 3rd numeric).
- 1 numeric + 2 categorical (low cardinality) → `grouped_bar`,
  `stacked_bar`, `heatmap`.
- 1 categorical + 1 numeric share-of-total intent → `pie` (≤ 6 slices)
  else `bar`.
- 1 numeric, no dims → `histogram`, `box`, `kpi`.
- Geo field present → `choropleth` (region) or `point_map` (lat/lng).

Each rule outputs a `score ∈ [0, 1]`. Final ranking is by score, with
chart-type name as tiebreak for determinism.

## 6. Configuration

Env vars (all optional; sensible defaults):

```
AI_ENABLED=false
AI_PROVIDER=none                # none | openai | bedrock | anthropic
AI_TIMEOUT_MS=1500
AI_FEATURES_RECOMMEND=true
AI_FEATURES_MAPPING=true
AI_FEATURES_CLASSIFY=true
AI_FEATURES_INSIGHTS=true
API_PORT=3001
WEB_PORT=5173
```

## 7. Testing strategy (added when tests are requested)

- Core: pure-function unit tests with table-driven cases.
- Gateway: tests for each failure mode forcing the fallback path.
- API: integration tests with `fastify.inject`.
- Web: smoke test of the one Phase 0 page.

Tests are not added in Phase 0 unless explicitly requested.
