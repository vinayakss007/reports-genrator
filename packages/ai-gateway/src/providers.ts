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
 * Resolve the configured provider. In Phase 0 there are no real
 * providers, so this always returns null and the gateway always falls
 * back to core. This keeps the AI surface area zero by default.
 */
export function getRecommendChartProvider(
  _provider: "none" | "openai" | "anthropic" | "bedrock",
): RecommendChartProvider | null {
  // Real providers are wired in Phase 5. Until then, no provider exists,
  // and that is intentional — the product must work without AI.
  return null;
}
