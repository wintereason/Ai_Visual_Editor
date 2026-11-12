import { describe, expect, it } from "vitest";
import { exampleProject, type Project } from "@avc/schema";
import { imageEditStyle, renderPage } from "../src";

const imgHtml = (props: Record<string, unknown>, animation?: unknown) => {
  const p: Project = structuredClone(exampleProject);
  p.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { src: "https://x.test/a.jpg", alt: "A", fit: "cover", ...props }, ...(animation ? { animation: animation as never } : {}) });
  return renderPage(p, "page_home").html.match(/<img[^>]*data-node="im"[^>]*>/)![0];
};

describe("image edits render as inline CSS", () => {
  it("no edits, no style attribute", () => {
    expect(imgHtml({})).not.toContain("style=");
  });
  it("adjustments become one filter, in a fixed order, with percentages converted", () => {
    const h = imgHtml({ adjust: { blur: 3, brightness: 120, saturation: 80, contrast: 110, grayscale: 50 } });
    expect(h).toContain("filter:brightness(1.2) contrast(1.1) saturate(0.8) grayscale(0.5) blur(3px)");
  });
  it("only the supplied adjustments appear, and 100 / 0 are still honoured", () => {
    expect(imgHtml({ adjust: { brightness: 100 } })).toContain("filter:brightness(1)");
    expect(imgHtml({ adjust: { blur: 0 } })).toContain("filter:blur(0px)");
    expect(imgHtml({ adjust: { contrast: 150 } })).not.toContain("brightness");
  });
  it("circle masks make a square, cropped circle; rounded masks round the corners", () => {
    const c = imgHtml({ mask: "circle" });
    expect(c).toContain("border-radius:50%");
    expect(c).toContain("aspect-ratio:1 / 1");
    expect(c).toContain("object-fit:cover");
    expect(imgHtml({ mask: "rounded" })).toContain("border-radius:16px");
  });
  it("edits and an animation's timing variables coexist on one element", () => {
    const h = imgHtml({ adjust: { brightness: 90 } }, { preset: "fade-in", durationMs: 900 });
    expect(h).toContain("filter:brightness(0.9)");
    expect(h).toContain("--d:900ms");
  });
  it("garbage values never reach the CSS (defence in depth: the schema already rejects them)", () => {
    const evil = imageEditStyle({ adjust: { brightness: "1); background:url(//evil)", contrast: Number.NaN, blur: Infinity }, mask: "x" });
    expect(evil).toBeUndefined();
    expect(imgHtml({ adjust: { brightness: Number.NaN } })).not.toContain("filter");
  });
});
