import { describe, expect, it } from "vitest";
import { exampleProject, validateProject, type Node, type Project } from "@avc/schema";
import { placeStyle, renderPage } from "../src";

const group = (children: Node[], props: Record<string, unknown> = { aspect: "16 / 9" }): Node => ({ id: "lg", kind: "layerGroup", type: "layerGroup", props, children });
const project = (g: Node): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[1]!.children!.push(g);
  return p;
};
const render = (g: Node) => {
  const p = project(g);
  const v = validateProject(p);
  if (!v.ok) throw new Error(v.issues.map((i) => i.message).join());
  return renderPage(p, "page_home");
};

describe("layerGroup rendering", () => {
  const a: Node = { id: "a", kind: "element", type: "text", props: { text: "Hello" }, place: { x: 10, y: 20, w: 50 } };
  const b: Node = { id: "b", kind: "element", type: "shape", props: { shape: "circle" }, place: { x: 60, y: 5, w: 25, r: 30 } };

  it("makes a fixed-shape box and puts each layer at its percentage position, in order", () => {
    const { html } = render(group([a, b]));
    expect(html).toMatch(/class="avc-lg n-lg"/);
    expect(html).toContain("aspect-ratio:16 / 9");
    expect(html).toContain('data-layer="a" style="left:10%;top:20%;width:50%"');
    expect(html).toContain('data-layer="b" style="left:60%;top:5%;width:25%;transform:rotate(30deg)"');
    expect(html.indexOf('data-layer="a"')).toBeLessThan(html.indexOf('data-layer="b"')); // later = on top
  });

  it("a labelled composition is announced as one picture", () => {
    expect(render(group([a], { aspect: "1 / 1", label: "Poster for open day" })).html).toContain('role="img" aria-label="Poster for open day"');
  });

  it("a hidden layer is not shown", () => {
    const hidden: Node = { ...a, styles: { base: { normal: { hidden: true } } } };
    expect(render(group([hidden])).css).toMatch(/\.n-a\{[^}]*display:none/);
  });

  it("each layer still keeps its own data-node so it can be selected", () => {
    expect(render(group([a, b])).html).toMatch(/data-node="a"/);
  });

  it("placement numbers are never trusted blindly", () => {
    expect(placeStyle({ x: NaN, y: Infinity, w: "50" as never } as never)).toEqual({ left: "10%", top: "10%", width: "40%" });
    expect(placeStyle(undefined)).toEqual({ left: "10%", top: "10%", width: "40%" });
  });

  it("an unknown aspect (from a damaged file) falls back instead of injecting CSS", () => {
    const g = group([a], { aspect: "1/1; background:url(//evil)" });
    const html = renderPage(project(g), "page_home").html;
    expect(html).not.toContain("evil");
    expect(html).toContain("aspect-ratio:16 / 9");
  });
});

describe("layer defaults never override what the person sets", () => {
  it("the group's default rules have zero specificity, so a hidden layer really is hidden", () => {
    const { css } = renderPage(project(group([{ id: "a", kind: "element", type: "image", props: { src: "https://placehold.co/10", alt: "x", fit: "cover" }, place: { x: 0, y: 0, w: 50 }, styles: { base: { normal: { hidden: true } } } }])), "page_home");
    expect(css).toContain(":where(.avc-lp)>:where(img,svg)");
    expect(css).not.toMatch(/(^|[^(])\.avc-lp>(img|svg)/);
    expect(css).toContain(".avc-lp>*{width:100%"); // but a layer's width always comes from its placement
  });
});

describe("image fit", () => {
  const img = (fit: string): Node => ({ id: "im", kind: "element", type: "image", props: { src: "https://placehold.co/10", alt: "x", fit }, place: { x: 0, y: 0, w: 100 } });
  it("is cropped to fill by default and shown whole for contain; neither stretches", () => {
    const cover = renderPage(project(group([img("cover")])), "page_home");
    const contain = renderPage(project(group([img("contain")])), "page_home");
    expect(cover.css).toContain(":where(img){object-fit:cover}");
    expect(cover.html).not.toContain("avc-contain");
    expect(contain.html).toMatch(/class="n-im avc-contain"/);
    expect(contain.css).toContain(".avc-contain{object-fit:contain}");
  });
});
