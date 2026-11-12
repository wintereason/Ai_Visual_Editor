import { describe, expect, it } from "vitest";
import { describeProps, exampleProject, validateProject, type FieldInfo, type Project } from "../src";

const withImage = (props: Record<string, unknown>): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { src: "https://x.test/a.jpg", alt: "A", fit: "cover", ...props } });
  return p;
};
const ok = (props: Record<string, unknown>) => validateProject(withImage(props)).ok;

describe("image adjustments and mask", () => {
  it("accepts in-range values, partial objects, and both masks", () => {
    expect(ok({})).toBe(true);
    expect(ok({ adjust: { brightness: 120 } })).toBe(true);
    expect(ok({ adjust: { brightness: 0, contrast: 200, saturation: 100, grayscale: 100, blur: 20 } })).toBe(true);
    expect(ok({ mask: "circle" })).toBe(true);
    expect(ok({ mask: "rounded", adjust: { blur: 2.5 } })).toBe(true);
  });
  it("rejects out-of-range values, unknown adjustments, bad masks and wrong types", () => {
    expect(ok({ adjust: { brightness: 201 } })).toBe(false);
    expect(ok({ adjust: { brightness: -1 } })).toBe(false);
    expect(ok({ adjust: { blur: 21 } })).toBe(false);
    expect(ok({ adjust: { grayscale: 101 } })).toBe(false);
    expect(ok({ adjust: { sepia: 50 } })).toBe(false); // unknown key
    expect(ok({ adjust: { brightness: "bright" } })).toBe(false);
    expect(ok({ adjust: { brightness: Number.NaN } })).toBe(false);
    expect(ok({ adjust: { brightness: Infinity } })).toBe(false);
    expect(ok({ mask: "star" })).toBe(false);
    expect(ok({ adjust: "brightness(1); background:url(x)" })).toBe(false); // no raw CSS can be smuggled in
  });
  it("describeProps exposes them to the Inspector with the right limits", () => {
    const fields = describeProps("image");
    const adjust = fields.find((f) => f.key === "adjust") as Extract<FieldInfo, { kind: "object" }>;
    expect(adjust.kind).toBe("object");
    expect(adjust.optional).toBe(true);
    expect(adjust.fields.map((f) => f.key).sort()).toEqual(["blur", "brightness", "contrast", "grayscale", "saturation"]);
    expect(adjust.fields.every((f) => f.kind === "number" && f.optional)).toBe(true);
    expect(fields.find((f) => f.key === "mask")).toMatchObject({ kind: "enum", options: ["circle", "rounded"], optional: true });
  });
});

import { CROP_ASPECTS, cropRect } from "../src";

describe("cropRect", () => {
  const area = (r: { w: number; h: number }, w: number, h: number) => (r.w * w) / (r.h * h); // resulting aspect ratio in pixels
  it("crops a landscape image to a square: full height, centred width", () => {
    const r = cropRect(300, 200, 1);
    expect(r.h).toBe(1);
    expect(r.w).toBeCloseTo(200 / 300);
    expect(r.x).toBeCloseTo((1 - 200 / 300) / 2);
    expect(r.y).toBe(0);
    expect(area(r, 300, 200)).toBeCloseTo(1);
  });
  it("crops a portrait image to a square: full width, centred height", () => {
    const r = cropRect(200, 300, 1);
    expect(r.w).toBe(1);
    expect(r.h).toBeCloseTo(200 / 300);
    expect(area(r, 200, 300)).toBeCloseTo(1);
  });
  it("hits every preset aspect ratio exactly, for several image shapes", () => {
    for (const [w, h] of [[300, 200], [200, 300], [1000, 1000], [4000, 1000], [1000, 4000]] as const)
      for (const ar of Object.values(CROP_ASPECTS)) {
        const r = cropRect(w, h, ar);
        expect(area(r, w, h)).toBeCloseTo(ar, 6);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      }
  });
  it("position slides the window between the edges and is clamped", () => {
    expect(cropRect(300, 200, 1, 0, 0).x).toBe(0);
    const right = cropRect(300, 200, 1, 1, 0);
    expect(right.x + right.w).toBeCloseTo(1);
    expect(cropRect(300, 200, 1, -5, 0).x).toBe(0);
    expect(cropRect(300, 200, 1, 9, 0).x).toBeCloseTo(1 - 200 / 300);
    expect(cropRect(300, 200, 1, Number.NaN, 0).x).toBeCloseTo((1 - 200 / 300) / 2); // NaN falls back to centre
  });
  it("an image already at the target ratio is returned whole; bad input returns the whole image", () => {
    expect(cropRect(400, 300, 4 / 3)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    for (const bad of [[0, 100, 1], [100, 0, 1], [100, 100, 0], [-1, 100, 1], [100, 100, Number.NaN]] as const)
      expect(cropRect(bad[0], bad[1], bad[2])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
