import { recommendChart as coreRecommend } from "@reports/core";
import {
  AiRecommendResponseSchema,
  type Profile,
  type RecommendationResult,
} from "@reports/shared";
import { getConfig } from "./config.js";
import { emit } from "./telemetry.js";
import { getRecommendChartProvider } from "./providers.js";

/**
 * The AI gateway's `recommendChart` entry point.
 *
 * Behavior contract (binding):
 *
 *   1. Reads env + customer toggles. If AI is off OR the feature is
 *      off, returns the deterministic core ranking with no network call.
 *   2. Applies a configured timeout to any provider call.
 *   3. Validates the provider response with a Zod schema.
 *   4. On ANY of {disabled, no provider, timeout, invalid response,
 *      provider error}, silently returns the deterministic core ranking.
 *   5. Never throws to callers.
 *   6. Emits a telemetry event with mode and reason.
 *
 * The deterministic ranking from `@reports/core` is always the system
 * of record. AI may at most reorder or annotate; if it tries to
 * introduce a chart type the core did not, the gateway drops it.
 */
export async function recommendChart(profile: Profile): Promise<RecommendationResult> {
  const startedAt = Date.now();
  const config = getConfig();
  const fallback = coreRecommend(profile);

  // Toggle gates — return without any network activity.
  if (!config.enabled) {
    emit({ call: "recommendChart", mode: "fallback", reason: "ai_disabled", latencyMs: 0 });
    return { recommendations: fallback, source: "core", fallbackReason: "ai_disabled" };
  }
  if (!config.features.recommend) {
    emit({ call: "recommendChart", mode: "fallback", reason: "feature_disabled", latencyMs: 0 });
    return { recommendations: fallback, source: "core", fallbackReason: "feature_disabled" };
  }

  const provider = getRecommendChartProvider(config.provider);
  if (!provider) {
    emit({ call: "recommendChart", mode: "fallback", reason: "ai_disabled", latencyMs: 0 });
    return { recommendations: fallback, source: "core", fallbackReason: "ai_disabled" };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort("timeout"), config.timeoutMs);

  try {
    const raw = await provider.recommendChart(profile, ac.signal);
    const parsed = AiRecommendResponseSchema.safeParse({ recommendations: raw });
    if (!parsed.success) {
      emit({
        call: "recommendChart",
        mode: "fallback",
        reason: "ai_invalid_response",
        latencyMs: Date.now() - startedAt,
      });
      return {
        recommendations: fallback,
        source: "core",
        fallbackReason: "ai_invalid_response",
      };
    }

    // Constrain the AI to the chart set the core proposed. AI may only
    // reorder; it cannot invent chart types or override scores upward
    // beyond the core ceiling. This keeps the AI from being load-bearing.
    const allowed = new Set(fallback.map((r) => r.chart));
    const filtered = parsed.data.recommendations.filter((r) => allowed.has(r.chart));
    if (filtered.length === 0) {
      emit({
        call: "recommendChart",
        mode: "fallback",
        reason: "ai_invalid_response",
        latencyMs: Date.now() - startedAt,
      });
      return {
        recommendations: fallback,
        source: "core",
        fallbackReason: "ai_invalid_response",
      };
    }

    emit({
      call: "recommendChart",
      mode: "ai",
      reason: "ok",
      latencyMs: Date.now() - startedAt,
    });
    return { recommendations: filtered, source: "ai" };
  } catch (err) {
    const reason: RecommendationResult["fallbackReason"] =
      ac.signal.aborted ? "ai_timeout" : "ai_provider_error";
    emit({
      call: "recommendChart",
      mode: "fallback",
      reason,
      latencyMs: Date.now() - startedAt,
    });
    return { recommendations: fallback, source: "core", fallbackReason: reason };
  } finally {
    clearTimeout(timer);
  }
}
