export { writeCsv, escapeCsvField } from "./csv.js";
export type { WriteCsvOptions } from "./csv.js";
export { writeXlsx } from "./xlsx.js";
export type { XlsxSheet } from "./xlsx.js";
export { writeJson } from "./json.js";

export type ExportMime = "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/json";

export const EXPORT_MIME: Record<"csv" | "xlsx" | "json", ExportMime> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
};

export const EXPORT_EXTENSION: Record<"csv" | "xlsx" | "json", string> = {
  csv: "csv",
  xlsx: "xlsx",
  json: "json",
};
