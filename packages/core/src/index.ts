export { recommendChart } from "./recommend/recommend.js";
export { inferRoles } from "./recommend/roles.js";

export {
  profileRows,
  profileColumn,
  primaryKeyCandidates,
  detectValueType,
  detectSemantic,
  widenType,
  isNullish,
  isMonotonicTime,
} from "./profile/index.js";
export type { ProfileOptions } from "./profile/index.js";

export { aggregate, chooseAgg, applyFilters } from "./aggregate/index.js";
export type {
  AggFn,
  AggregateSpec,
  AggregateResult,
  MeasureAgg,
  Filter,
  FilterOp,
} from "./aggregate/index.js";

export { autoEncode } from "./encode/index.js";
export type {
  AutoEncodeOptions,
  ChartEncoding,
  ChartSpec,
  EncodableField,
  SlotField,
} from "./encode/index.js";

export {
  pickColors,
  pickPalette,
  contrastRatio,
  ALL_PALETTES,
  CATEGORICAL_8,
  CATEGORICAL_16,
  SEQUENTIAL_BLUE,
  SEQUENTIAL_GREEN,
  DIVERGING_RDBU,
} from "./color/index.js";
export type { Palette, EncodingKind, PickColorsOptions, PickedColors } from "./color/index.js";

export { classifyColumn, classifySchema } from "./classify/index.js";
export { mapFields } from "./mapping/index.js";
export type { MappingSlot, MappingResult } from "./mapping/index.js";
export { narrativeInsights } from "./insights/index.js";
export type { SeriesStats } from "./insights/index.js";

export {
  decompose,
  movingAverage,
  detectAnomalies,
  holtWinters,
} from "./stats/index.js";
export type {
  Decomposition,
  DecomposeOptions,
  AnomalyPoint,
  AnomalyOptions,
  ForecastResult,
  ForecastOptions,
} from "./stats/index.js";
