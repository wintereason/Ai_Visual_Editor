import { describe, expect, it } from "vitest";
import { describeProps, REGISTRY, type FieldInfo } from "../src";

const byKey = (fs: FieldInfo[], k: string) => fs.find((f) => f.key === k)!;

describe("describeProps", () => {
  it("covers every registered type without throwing, and never returns an 'unknown' field", () => {
    for (const type of REGISTRY.keys()) {
      const walk = (f: FieldInfo, path: string) => {
        expect(f.kind, `${path}`).not.toBe("unknown");
        if (f.kind === "array") walk(f.item, `${path}[]`);
        if (f.kind === "object") f.fields.forEach((c) => walk(c, `${path}.${c.key}`));
      };
      describeProps(type).forEach((f) => walk(f, `${type}.${f.key}`));
    }
  });
  it("reports optional vs required, including defaults and refined schemas", () => {
    const hero = describeProps("hero");
    expect(byKey(hero, "headline")).toMatchObject({ kind: "string", optional: false });
    expect(byKey(hero, "subheadline")).toMatchObject({ kind: "string", optional: true });
    expect(byKey(hero, "imageAssetId")).toMatchObject({ kind: "string", optional: true });
    expect(byKey(describeProps("heading"), "level")).toMatchObject({ kind: "number", optional: true }); // has a default
    expect(byKey(describeProps("input"), "required")).toMatchObject({ kind: "boolean" });
  });
  it("describes enums with their options", () => {
    expect(byKey(describeProps("image"), "fit")).toMatchObject({ kind: "enum", options: ["cover", "contain"] });
    expect(byKey(describeProps("embed"), "provider")).toMatchObject({ kind: "enum", options: ["youtube", "map"] }); // through the refine wrapper
  });
  it("describes arrays of objects with each field's optionality (pricing, team, gallery)", () => {
    const plans = byKey(describeProps("pricing"), "plans");
    expect(plans.kind).toBe("array");
    const item = (plans as Extract<FieldInfo, { kind: "array" }>).item as Extract<FieldInfo, { kind: "object" }>;
    expect(item.kind).toBe("object");
    expect(byKey(item.fields, "name").optional).toBe(false);
    expect(byKey(item.fields, "period").optional).toBe(true);
    expect(byKey(item.fields, "highlighted")).toMatchObject({ kind: "boolean", optional: true });
    expect(byKey(item.fields, "features")).toMatchObject({ kind: "array", item: { kind: "string" } });

    const members = (byKey(describeProps("team"), "members") as Extract<FieldInfo, { kind: "array" }>).item as Extract<FieldInfo, { kind: "object" }>;
    expect(byKey(members.fields, "imageAssetId")).toMatchObject({ kind: "string", optional: true });
    const images = (byKey(describeProps("gallery"), "images") as Extract<FieldInfo, { kind: "array" }>).item as Extract<FieldInfo, { kind: "object" }>;
    expect(images.fields.map((f) => f.key)).toEqual(["assetId", "src", "alt"]); // through the .refine() on the item
  });
  it("returns nothing for unknown types", () => {
    expect(describeProps("nope")).toEqual([]);
  });
});
