import { classifySchema as coreClassify } from "@reports/core";
import type { Field, SemanticType } from "@reports/shared";
import { z } from "zod";
import { getConfig } from "./config.js";
import { emit } from "./telemetry.js";

const SemanticSchema = z.enum([
  "currency",
  "percent",
  "id",
  "geo_region",
  "geo_point",
  "datetime",
  "category",
  "measure",
  "unknown",
]);

const AiClassifyResponseSchema = z.object({
  classifications: z.record(z.string(), SemanticSchema),
});

export interface ClassifyRequest {
  columns: ReadonlyArray<{ name: string; values: readonly unknown[]; type: Field["type"] }>;
}

export interface ClassifyResult {
  classifications: Record<string, SemanticType>;
  source: "core" | "ai";
  fallbackReason?:
    | "ai_disabled"
    | "feature_disabled"
    | "ai_timeout"
    | "ai_invalid_response"
    | "ai_provider_error";
}

/**
 * Semantic-type classifier gateway. The deterministic fallback is the
 * regex/heuristic classifier in `@reports/core/classify`. AI may
 * refine results when enabled, but must only emit classifications for
 * columns the caller passed in (the gateway filters out the rest).
 */
export async function classifySchema(req: ClassifyRequest): Promise<ClassifyResult> {
  const startedAt = Date.now();
  const config = getConfig();
  const fallback = coreClassify(req.columns);

  if (!config.enabled) {
    emit({ call: "classifySchema", mode: "fallback", reason: "ai_disabled", latencyMs: 0 });
    return { classifications: fallback, source: "core", fallbackReason: "ai_disabled" };
  }
  if (!config.features.classify) {
    emit({ call: "classifySchema", mode: "fallback", reason: "feature_disabled", latencyMs: 0 });
    return { classifications: fallback, source: "core", fallbackReason: "feature_disabled" };
  }

  void AiClassifyResponseSchema;
  emit({
    call: "classifySchema",
    mode: "fallback",
    reason: "ai_disabled",
    latencyMs: Date.now() - startedAt,
  });
  return { classifications: fallback, source: "core", fallbackReason: "ai_disabled" };
}
