/**
 * Deterministic palette picker.
 *
 * Inputs:
 *   - kind: the encoding kind, derived from field role and chart type.
 *   - count: number of distinct categories (for categorical), or `undefined`.
 *   - hint: optional bias toward a specific palette family.
 *
 * Output: a Palette and the exact colors to use, in order, of length `count`.
 *
 * Same inputs -> same output. No AI, no randomness.
 */

import type { Palette } from "./palettes.js";
import {
  ALL_PALETTES,
  CATEGORICAL_16,
  CATEGORICAL_8,
  DIVERGING_RDBU,
  SEQUENTIAL_BLUE,
  SEQUENTIAL_GREEN,
} from "./palettes.js";

export type EncodingKind = "categorical" | "sequential" | "diverging";

export interface PickColorsOptions {
  kind: EncodingKind;
  count?: number;
  hint?: "blue" | "green" | "rdbu";
}

export interface PickedColors {
  palette: Palette;
  colors: string[];
}

export function pickColors(opts: PickColorsOptions): PickedColors {
  const palette = pickPalette(opts);
  const count = opts.count ?? palette.colors.length;
  const colors = sampleEvenly(palette.colors, count);
  return { palette, colors };
}

export function pickPalette(opts: PickColorsOptions): Palette {
  if (opts.kind === "categorical") {
    if ((opts.count ?? 0) > CATEGORICAL_8.colors.length) return CATEGORICAL_16;
    return CATEGORICAL_8;
  }
  if (opts.kind === "diverging") return DIVERGING_RDBU;
  // sequential
  if (opts.hint === "green") return SEQUENTIAL_GREEN;
  return SEQUENTIAL_BLUE;
}

/**
 * Pick `count` colors evenly across `palette`, repeating for very large
 * counts via deterministic hue cycling.
 */
function sampleEvenly(palette: readonly string[], count: number): string[] {
  if (count <= 0) return [];
  if (palette.length === 0) return Array(count).fill("#888888");
  if (count <= palette.length) {
    if (count === palette.length) return palette.slice();
    // Pick `count` colors at evenly spaced indices.
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i * (palette.length - 1)) / Math.max(1, count - 1));
      out.push(palette[idx]!);
    }
    return out;
  }
  // count > palette.length: cycle deterministically.
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(palette[i % palette.length]!);
  return out;
}

/**
 * WCAG 2.x relative-luminance contrast ratio between two hex colors.
 * Returns a number in [1, 21]; 4.5 is the AA threshold for normal text.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) {
    return {
      r: parseInt(h[0]! + h[0]!, 16),
      g: parseInt(h[1]! + h[1]!, 16),
      b: parseInt(h[2]! + h[2]!, 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export { ALL_PALETTES };
