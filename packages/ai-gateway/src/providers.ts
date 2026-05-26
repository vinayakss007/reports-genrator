/**
 * Provider adapter interface. No real provider is wired in Phase 0;
 * everything routes to the deterministic core fallback.
 *
 * When real providers are added (Phase 5), each one implements this
 * interface and lives only inside this package. No AI SDK is allowed
 * outside `packages/ai-gateway`.
 */

import type { Profile, Recommendation } from "@reports/shared";

export interface RecommendChartProvider {
  /**
   * Returns a list of recommendations or throws / rejects on any error.
   * The gateway is responsible for timeouts, validation, and fallback.
   */
  recommendChart(profile: Profile, signal: AbortSignal): Promise<Recommendation[]>;
}

/**
 * Resolve the configured provider. Returns null when no real provider
 * is available (the default); the gateway then falls back to core.
 *
 * Supported providers:
 *   - "openai"    requires OPENAI_API_KEY env
 *   - "anthropic" placeholder (not yet implemented)
 *   - "bedrock"   placeholder (not yet implemented)
 *   - "none"      always null
 */
export function getRecommendChartProvider(
  provider: "none" | "openai" | "anthropic" | "bedrock",
): RecommendChartProvider | null {
  if (provider === "openai") {
    // Dynamic import avoided; inline require so the module tree stays
    // small when the provider is not used.
    try {
      const { createOpenAIProvider } = require("./providers/openai.js") as {
        createOpenAIProvider: () => RecommendChartProvider | null;
      };
      return createOpenAIProvider();
    } catch {
      return null;
    }
  }
  // anthropic/bedrock: add adapters here following the same pattern.
  return null;
}
