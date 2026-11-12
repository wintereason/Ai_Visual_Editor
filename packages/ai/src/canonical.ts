/**
 * JSON with object keys sorted, so two structurally identical values compare equal regardless of key order.
 * Needed because schema validation re-creates objects in schema order: a plain JSON.stringify comparison would call an
 * unchanged project "changed" whenever its keys happened to be written in a different order.
 */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value));
}
