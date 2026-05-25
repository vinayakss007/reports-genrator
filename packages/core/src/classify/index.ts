/**
 * Standalone semantic-type classifier surface. The actual heuristics
 * live in `profile/detect.ts`; this module re-exports them so the AI
 * gateway can call into a stable API and the rest of the codebase
 * isn't tightly coupled to the profiler's file layout.
 */
import type { Field, SemanticType } from "@reports/shared";
import { detectSemantic } from "../profile/detect.js";

/**
 * Classify a single column into a semantic type. Inputs are the column
 * name, a sample of values, and the column's primitive data type.
 *
 * Pure function. Same inputs -> same output.
 */
export function classifyColumn(
  name: string,
  values: readonly unknown[],
  type: Field["type"],
): SemanticType {
  return detectSemantic(name, values, type);
}

/**
 * Classify every column in a profile-like input. Useful as the
 * deterministic fallback for the AI gateway's `classifySchema` call.
 */
export function classifySchema(
  columns: ReadonlyArray<{ name: string; values: readonly unknown[]; type: Field["type"] }>,
): Record<string, SemanticType> {
  const out: Record<string, SemanticType> = {};
  for (const c of columns) out[c.name] = classifyColumn(c.name, c.values, c.type);
  return out;
}
