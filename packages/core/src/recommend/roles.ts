import type { Field, FieldRole } from "@reports/shared";

/**
 * Pure, deterministic role inference. Used by the recommender when a
 * field's `role` is not provided by the caller.
 */
export function inferRoles(fields: Field[]): Field[] {
  return fields.map((f) => (f.role ? f : { ...f, role: inferRole(f) }));
}

function inferRole(f: Field): FieldRole {
  if (f.isTemporal || f.type === "datetime" || f.type === "date") return "time";
  if (f.isGeo || f.type === "geo") return "geo";
  if (f.semantic === "id") return "id";
  if (f.type === "number" || f.type === "integer") return "measure";
  return "dimension";
}
