---
inclusion: always
---

# AI Usage Policy (binding for this repository)

AI must **never** be load-bearing. The product must build, run, and pass
all smoke tests with `AI_ENABLED=false`. Use real implementations only —
no mocks, fakes, placeholders, or stub code committed to main.

## Allowed AI uses

Only these call types may invoke AI, and each must have a deterministic
fallback that fully ships:

1. `recommendChart(profile)` — chart-type recommendation given data shape.
   Fallback: rule-based recommender in `packages/core`.
2. `mapFields(profile, target)` — field-to-slot mapping hints.
   Fallback: greedy match by name + type.
3. `classifySchema(profile)` — semantic-type tags
   (`currency | percent | id | geo | datetime | ...`).
   Fallback: regex + heuristic classifier.
4. `narrativeInsights(stats)` — 1–3 short narrative bullets per chart.
   Fallback: deterministic templated bullets.

## Forbidden AI uses

These must be deterministic algorithms in `packages/core`, never AI:

- Layout, sizing, positioning of charts and dashboards.
- Color palette selection.
- Anomaly detection.
- Forecasting.
- Aggregation choice (`sum/avg/count/min/max/median`).
- Natural-language to SQL.
- Natural-language to dashboard.

## Gateway rules

All AI calls go through `packages/ai-gateway`. No AI SDK may be imported
anywhere else in the codebase.

The gateway must:

- Read env + customer toggles (`AI_ENABLED`, `AI_FEATURES.*`); when off,
  return the deterministic fallback without making a network call.
- Apply a timeout (default 1500ms); on timeout, return fallback.
- Validate every AI response against a Zod JSON schema; on any
  validation error, return fallback.
- Catch every provider error silently; on error, return fallback.
- Never throw to callers. Never surface AI errors to end users.
- Never run on a hot path. Specifically: never on render, never on
  auto-refresh, never inside a query plan.
- Emit telemetry: `{call, mode: "ai" | "fallback", reason, latencyMs}`.

## Code review checklist

- Does every AI code path have a deterministic fallback in `core`?
- Is the AI response Zod-validated?
- Are timeouts and toggles wired?
- Does the feature still work end-to-end with `AI_ENABLED=false`?
- Are there any AI calls outside `packages/ai-gateway`?
