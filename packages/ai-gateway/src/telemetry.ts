/**
 * Minimal, dependency-free telemetry sink. Real deployments can replace
 * the default sink with one that ships to a logger or metrics pipeline.
 */

export interface GatewayTelemetry {
  call: "recommendChart" | "mapFields" | "classifySchema" | "narrativeInsights";
  mode: "ai" | "fallback";
  reason?:
    | "ai_disabled"
    | "feature_disabled"
    | "ai_timeout"
    | "ai_invalid_response"
    | "ai_provider_error"
    | "ok";
  latencyMs: number;
}

type Sink = (event: GatewayTelemetry) => void;

let sink: Sink = () => {
  /* default: drop on the floor */
};

export function setTelemetrySink(s: Sink): void {
  sink = s;
}

export function emit(event: GatewayTelemetry): void {
  try {
    sink(event);
  } catch {
    /* never throw from telemetry */
  }
}
