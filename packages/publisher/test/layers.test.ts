import { describe, expect, it } from "vitest";
import { exampleProject, type Node, type Project } from "@avc/schema";
import { buildSite } from "../src";

const dec = new TextDecoder();
const layers = (): Node[] => [
  { id: "bg", kind: "element", type: "image", props: { src: "https://placehold.co/600x400", alt: "Open day", fit: "cover" }, place: { x: 0, y: 0, w: 100 } },
  { id: "tag", kind: "element", type: "shape", props: { shape: "burst", label: "New" }, place: { x: 70, y: 5, w: 25, r: 10 } },
  { id: "tx", kind: "element", type: "heading", props: { text: "Open day", level: 2 }, place: { x: 10, y: 40, w: 80 } },
];
const project = (): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[1]!.children!.push({ id: "lg", kind: "layerGroup", type: "layerGroup", props: { aspect: "4 / 3", label: "Open day poster" }, children: layers() });
  return p;
};

describe("a site with a photo-layer composition publishes cleanly", () => {
  it("builds, keeps the layer order and percentages, and announces the composition", async () => {
    const r = await buildSite(project(), [], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = dec.decode(r.files["index.html"]);
    expect(html).toContain('role="img" aria-label="Open day poster"');
    expect(html).toContain("aspect-ratio:4 / 3");
    expect(html).toContain('style="left:70%;top:5%;width:25%;transform:rotate(10deg)"');
    expect(html.indexOf('data-layer="bg"')).toBeLessThan(html.indexOf('data-layer="tx"'));
  });

  it("still enforces the usual rules inside a group (a picture needs alt text)", async () => {
    const p = project();
    (p.pages[0]!.nodes[1]!.children!.at(-1)!.children![0]!.props as Record<string, unknown>).alt = "";
    const r = await buildSite(p, [], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(false);
  });
});
