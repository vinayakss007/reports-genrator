/**
 * Deterministic field-to-slot greedy matcher.
 *
 * Given a list of available fields and a list of target slots
 * (each with a desired role and optional name hint), assign the
 * best-fit field to each slot. Each field is used at most once.
 *
 * This is the deterministic fallback for the AI gateway's
 * `mapFields` call.
 */

import type { Field } from "@reports/shared";

export interface MappingSlot {
  /** Slot identifier returned in the mapping result. */
  id: string;
  /** Desired role: dimension, measure, time, geo, id. */
  role: "dimension" | "measure" | "time" | "geo" | "id" | "any";
  /**
   * Optional name hint. If a field name contains this substring
   * (case-insensitive), it is preferred.
   */
  hint?: string;
}

export interface MappingResult {
  /** slotId -> chosen field name, or null if no field fit. */
  assignments: Record<string, string | null>;
  /** Field names not assigned to any slot. */
  unassigned: string[];
}

export function mapFields(
  fields: readonly Field[],
  slots: readonly MappingSlot[],
): MappingResult {
  const used = new Set<string>();
  const assignments: Record<string, string | null> = {};

  // Process slots in input order so the result is deterministic.
  for (const slot of slots) {
    const candidates = fields.filter((f) => !used.has(f.name) && roleMatches(f, slot.role));
    if (candidates.length === 0) {
      assignments[slot.id] = null;
      continue;
    }
    const scored = candidates.map((f) => ({
      f,
      score: scoreFit(f, slot),
    }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.f.name < b.f.name ? -1 : 1;
    });
    const chosen = scored[0]!.f;
    assignments[slot.id] = chosen.name;
    used.add(chosen.name);
  }

  const unassigned = fields.filter((f) => !used.has(f.name)).map((f) => f.name);
  return { assignments, unassigned };
}

function roleMatches(f: Field, role: MappingSlot["role"]): boolean {
  if (role === "any") return true;
  return f.role === role;
}

function scoreFit(f: Field, slot: MappingSlot): number {
  let s = 0;
  if (slot.hint) {
    const h = slot.hint.toLowerCase();
    const n = f.name.toLowerCase();
    if (n === h) s += 100;
    else if (n.includes(h)) s += 50;
  }
  // Prefer concrete roles over inferred ones.
  if (f.role === slot.role) s += 10;
  // Prefer non-null fields.
  if ((f.nullRate ?? 0) === 0) s += 5;
  // For dimensions, lower cardinality is better.
  if (slot.role === "dimension" && f.cardinality != null) {
    if (f.cardinality > 0 && f.cardinality <= 12) s += 4;
    else if (f.cardinality <= 50) s += 2;
  }
  return s;
}
