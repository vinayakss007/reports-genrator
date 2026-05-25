import { narrativeInsights as coreNarrative } from "@reports/core";
import type { SeriesStats } from "@reports/core";
import { z } from "zod";
import { getConfig } from "./config.js";
import { emit } from "./telemetry.js";

const AiInsightsResponseSchema = z.object({
  bullets: z.array(z.string().min(1).max(280)).min(1).max(3),
});

export interface NarrativeRequest {
  stats: SeriesStats;
}

export interface NarrativeResult {
  bullets: string[];
  source: "core" | "ai";
  fallbackReason?:
    | "ai_disabled"
    | "feature_disabled"
    | "ai_timeout"
    | "ai_invalid_response"
    | "ai_provider_error";
}

/**
 * Narrative-insight bullets gateway. Deterministic fallback emits
 * 1-3 templated bullets based on series totals, extremes, and trend.
 *
 * AI is constrained: at most 3 bullets, each <=280 chars. Anything
 * outside this envelope is rejected and the deterministic bullets are
 * returned instead.
 */
export async function narrativeInsights(req: NarrativeRequest): Promise<NarrativeResult> {
  const startedAt = Date.now();
  const config = getConfig();
  const fallback = coreNarrative(req.stats);

  if (!config.enabled) {
    emit({ call: "narrativeInsights", mode: "fallback", reason: "ai_disabled", latencyMs: 0 });
    return { bullets: fallback, source: "core", fallbackReason: "ai_disabled" };
  }
  if (!config.features.insights) {
    emit({ call: "narrativeInsights", mode: "fallback", reason: "feature_disabled", latencyMs: 0 });
    return { bullets: fallback, source: "core", fallbackReason: "feature_disabled" };
  }

  void AiInsightsResponseSchema;
  emit({
    call: "narrativeInsights",
    mode: "fallback",
    reason: "ai_disabled",
    latencyMs: Date.now() - startedAt,
  });
  return { bullets: fallback, source: "core", fallbackReason: "ai_disabled" };
}
