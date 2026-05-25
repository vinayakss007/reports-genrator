import { mapFields as coreMapFields } from "@reports/core";
import type { Field } from "@reports/shared";
import { z } from "zod";
import { getConfig } from "./config.js";
import { emit } from "./telemetry.js";

const AiMapResponseSchema = z.object({
  assignments: z.record(z.string(), z.string().nullable()),
});

export interface MapFieldsRequest {
  fields: readonly Field[];
  slots: ReadonlyArray<{
    id: string;
    role: "dimension" | "measure" | "time" | "geo" | "id" | "any";
    hint?: string;
  }>;
}

export interface MapFieldsResult {
  assignments: Record<string, string | null>;
  unassigned: string[];
  source: "core" | "ai";
  fallbackReason?:
    | "ai_disabled"
    | "feature_disabled"
    | "ai_timeout"
    | "ai_invalid_response"
    | "ai_provider_error";
}

/**
 * AI gateway entry point for field-to-slot mapping.
 *
 *   1. If AI is disabled or the feature flag is off, return the
 *      deterministic core greedy match. No network activity.
 *   2. No real provider is wired in this PR; the gateway always falls
 *      back to core. The plumbing here is the contract that future
 *      provider adapters must satisfy: timeout, Zod validation,
 *      silent fallback, allowed-slot-only filtering.
 *   3. AI may at most reorder/refine; it must not introduce slot ids
 *      that the caller did not request.
 */
export async function mapFields(req: MapFieldsRequest): Promise<MapFieldsResult> {
  const startedAt = Date.now();
  const config = getConfig();
  const fallback = coreMapFields(req.fields, req.slots);

  if (!config.enabled) {
    emit({ call: "mapFields", mode: "fallback", reason: "ai_disabled", latencyMs: 0 });
    return { ...fallback, source: "core", fallbackReason: "ai_disabled" };
  }
  if (!config.features.mapping) {
    emit({ call: "mapFields", mode: "fallback", reason: "feature_disabled", latencyMs: 0 });
    return { ...fallback, source: "core", fallbackReason: "feature_disabled" };
  }

  // No provider available in this PR; gateway always falls back. Phase 5
  // will add adapters; the contract below is what they must satisfy.
  void AiMapResponseSchema;
  emit({
    call: "mapFields",
    mode: "fallback",
    reason: "ai_disabled",
    latencyMs: Date.now() - startedAt,
  });
  return { ...fallback, source: "core", fallbackReason: "ai_disabled" };
}
