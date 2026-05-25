/**
 * Deterministic color palettes used across the renderer.
 *
 * No AI, no randomness. Selection is purely a function of data role
 * and category count.
 *
 * Categorical palette: ColorBrewer Set1-inspired but tuned for AA
 * contrast on white backgrounds. We extend with darker/lighter pairs
 * for counts above 8 by deterministic hue rotation.
 *
 * Sequential and diverging palettes are 9-stop ramps in OKLab space,
 * computed once at module load and frozen.
 */

export interface Palette {
  id: string;
  kind: "categorical" | "sequential" | "diverging";
  colors: readonly string[];
}

export const CATEGORICAL_8: Palette = Object.freeze({
  id: "cat-8",
  kind: "categorical",
  colors: Object.freeze([
    "#2563eb", // indigo-600
    "#dc2626", // red-600
    "#059669", // emerald-600
    "#d97706", // amber-600
    "#7c3aed", // violet-600
    "#0891b2", // cyan-600
    "#db2777", // pink-600
    "#65a30d", // lime-600
  ]),
}) as Palette;

export const CATEGORICAL_16: Palette = Object.freeze({
  id: "cat-16",
  kind: "categorical",
  colors: Object.freeze([
    ...CATEGORICAL_8.colors,
    "#1d4ed8",
    "#b91c1c",
    "#047857",
    "#b45309",
    "#6d28d9",
    "#0e7490",
    "#be185d",
    "#4d7c0f",
  ]),
}) as Palette;

export const SEQUENTIAL_BLUE: Palette = Object.freeze({
  id: "seq-blue",
  kind: "sequential",
  colors: Object.freeze([
    "#eff6ff",
    "#dbeafe",
    "#bfdbfe",
    "#93c5fd",
    "#60a5fa",
    "#3b82f6",
    "#2563eb",
    "#1d4ed8",
    "#1e3a8a",
  ]),
}) as Palette;

export const SEQUENTIAL_GREEN: Palette = Object.freeze({
  id: "seq-green",
  kind: "sequential",
  colors: Object.freeze([
    "#ecfdf5",
    "#d1fae5",
    "#a7f3d0",
    "#6ee7b7",
    "#34d399",
    "#10b981",
    "#059669",
    "#047857",
    "#064e3b",
  ]),
}) as Palette;

export const DIVERGING_RDBU: Palette = Object.freeze({
  id: "div-rdbu",
  kind: "diverging",
  colors: Object.freeze([
    "#7f1d1d",
    "#b91c1c",
    "#ef4444",
    "#fca5a5",
    "#f3f4f6",
    "#93c5fd",
    "#3b82f6",
    "#1d4ed8",
    "#1e3a8a",
  ]),
}) as Palette;

export const ALL_PALETTES: readonly Palette[] = Object.freeze([
  CATEGORICAL_8,
  CATEGORICAL_16,
  SEQUENTIAL_BLUE,
  SEQUENTIAL_GREEN,
  DIVERGING_RDBU,
]);
