import { z } from "zod";
import { REGISTRY } from "./registry";

/**
 * A UI-friendly description of a block's props, derived from the same zod schema that validates them, so the
 * Inspector can never offer a field the schema does not know about, and never hides one it does.
 */
export type FieldInfo =
  | { key: string; optional: boolean; kind: "string" }
  | { key: string; optional: boolean; kind: "number" }
  | { key: string; optional: boolean; kind: "boolean" }
  | { key: string; optional: boolean; kind: "enum"; options: string[] }
  | { key: string; optional: boolean; kind: "array"; item: FieldInfo }
  | { key: string; optional: boolean; kind: "object"; fields: FieldInfo[] }
  | { key: string; optional: boolean; kind: "unknown" };

function unwrap(t: z.ZodTypeAny): { t: z.ZodTypeAny; optional: boolean } {
  let optional = false;
  let cur = t;
  for (let i = 0; i < 12; i++) {
    if (cur instanceof z.ZodOptional) { optional = true; cur = cur.unwrap(); }
    else if (cur instanceof z.ZodDefault) { optional = true; cur = cur.removeDefault(); }
    else if (cur instanceof z.ZodNullable) { optional = true; cur = cur.unwrap(); }
    else if (cur instanceof z.ZodEffects) cur = cur.innerType();
    else break;
  }
  return { t: cur, optional };
}

function describe(key: string, schema: z.ZodTypeAny): FieldInfo {
  const { t, optional } = unwrap(schema);
  if (t instanceof z.ZodString) return { key, optional, kind: "string" };
  if (t instanceof z.ZodNumber) return { key, optional, kind: "number" };
  if (t instanceof z.ZodBoolean) return { key, optional, kind: "boolean" };
  if (t instanceof z.ZodEnum) return { key, optional, kind: "enum", options: [...t.options] as string[] };
  if (t instanceof z.ZodArray) return { key, optional, kind: "array", item: describe("item", t.element) };
  if (t instanceof z.ZodObject) return { key, optional, kind: "object", fields: Object.entries(t.shape as Record<string, z.ZodTypeAny>).map(([k, s]) => describe(k, s)) };
  return { key, optional, kind: "unknown" };
}

/** Top-level props of a node type, in schema order. Empty for unknown types. */
export function describeProps(type: string): FieldInfo[] {
  const def = REGISTRY.get(type);
  if (!def) return [];
  const { t } = unwrap(def.props);
  if (!(t instanceof z.ZodObject)) return [];
  return Object.entries(t.shape as Record<string, z.ZodTypeAny>).map(([k, s]) => describe(k, s));
}
