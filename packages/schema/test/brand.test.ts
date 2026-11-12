import { describe, expect, it } from "vitest";
import { applyPatch, collectAssetIds, collectKeptAssetIds, exampleProject, validateProject, type Project } from "../src";

const base = (): Project => structuredClone(exampleProject);
const patch = (p: Project, brand: object, opts: Record<string, unknown> = {}) => applyPatch(p, { summary: "brand", ops: [{ op: "setBrand", brand } as never] }, opts as never);

describe("brand kit", () => {
  it("projects without a brand are still valid (old saved projects keep working)", () => {
    expect(validateProject(base()).ok).toBe(true);
  });

  it("sets name, colours, fonts and logo, and the result validates", () => {
    const r = patch(base(), { name: "Bright School", logoAssetId: "asset_1", colors: ["#1D4ED8", "#F59E0B"], fonts: [{ heading: "Lora", body: "Inter" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.brand).toEqual({ name: "Bright School", logoAssetId: "asset_1", colors: ["#1D4ED8", "#F59E0B"], fonts: [{ heading: "Lora", body: "Inter" }] });
    expect(validateProject(r.project).ok).toBe(true);
  });

  it("merges: changing one part keeps the others, and null removes a part", () => {
    const a = patch(base(), { name: "A", colors: ["#111111"] });
    if (!a.ok) throw new Error("setup");
    const b = patch(a.project, { name: "B" });
    if (!b.ok) throw new Error("merge");
    expect(b.project.brand).toEqual({ name: "B", colors: ["#111111"] });
    const c = patch(b.project, { name: null, colors: null });
    if (!c.ok) throw new Error("clear");
    expect(c.project.brand).toBeUndefined(); // an empty kit is removed, not left as {}
  });

  it("does not change the project it was given", () => {
    const p = base();
    patch(p, { name: "X" });
    expect(p.brand).toBeUndefined();
  });

  it("refuses colours that are not 6-digit hex, too many colours, and unknown keys", () => {
    for (const bad of [{ colors: ["red"] }, { colors: ["#FFF"] }, { colors: Array.from({ length: 13 }, () => "#000000") }, { fonts: Array.from({ length: 7 }, () => ({ heading: "A", body: "B" })) }, { nope: 1 }, { name: "x".repeat(61) }]) {
      expect(patch(base(), bad).ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });

  it("is outside the scope of an element-scoped (AI) edit", () => {
    const p = base();
    const id = p.pages[0]!.nodes[0]!.children![0]!.id;
    const r = patch(p, { name: "Hijack" }, { scope: id });
    expect(r.ok).toBe(false);
  });

  it("the logo counts as a file in use, so it can't be deleted from under the kit", () => {
    const r = patch(base(), { logoAssetId: "asset_logo" });
    if (!r.ok) throw new Error("setup");
    expect(collectKeptAssetIds(r.project).has("asset_logo")).toBe(true);
    expect(collectAssetIds(r.project).has("asset_logo")).toBe(false); // but it is not published until placed on a page
  });
});
