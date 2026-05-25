/**
 * Gateway configuration. AI is OFF by default. Toggles are read from
 * env at call time so tests and runtime feature flags can flip them
 * without restarting the process.
 */

export interface GatewayConfig {
  enabled: boolean;
  provider: "none" | "openai" | "anthropic" | "bedrock";
  timeoutMs: number;
  features: {
    recommend: boolean;
    mapping: boolean;
    classify: boolean;
    insights: boolean;
  };
}

const truthy = new Set(["1", "true", "yes", "on"]);

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return truthy.has(v.toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envProvider(): GatewayConfig["provider"] {
  const v = (process.env.AI_PROVIDER ?? "none").toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "bedrock") return v;
  return "none";
}

export function getConfig(): GatewayConfig {
  return {
    enabled: envBool("AI_ENABLED", false),
    provider: envProvider(),
    timeoutMs: envInt("AI_TIMEOUT_MS", 1500),
    features: {
      recommend: envBool("AI_FEATURES_RECOMMEND", true),
      mapping: envBool("AI_FEATURES_MAPPING", true),
      classify: envBool("AI_FEATURES_CLASSIFY", true),
      insights: envBool("AI_FEATURES_INSIGHTS", true),
    },
  };
}
