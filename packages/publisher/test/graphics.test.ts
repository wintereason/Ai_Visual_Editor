import { describe, expect, it } from "vitest";
import { exampleProject, type Project } from "@avc/schema";
import { buildSite } from "../src";

const dec = new TextDecoder();

describe("a site using icons, shapes, charts and tables publishes cleanly", () => {
  const project = (): Project => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children!.push(
      { id: "ic", kind: "element", type: "icon", props: { name: "star" } },
      { id: "sh", kind: "element", type: "shape", props: { shape: "hexagon", label: "Badge" } },
      { id: "ch", kind: "element", type: "chart", props: { chartType: "donut", title: "Split", data: [{ label: "A", value: 3 }, { label: "B", value: 7 }] } },
      { id: "ta", kind: "element", type: "table", props: { columns: ["Day", "Hours"], rows: ["Mon | 9 to 5"], caption: "Hours" } },
    );
    return p;
  };

  it("builds with no errors and the graphics are in the page", async () => {
    const r = await buildSite(project(), [], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = dec.decode(r.files["index.html"]);
    expect(html).toContain("avc-icon");
    expect(html).toContain("avc-shape");
    expect(html).toContain("avc-chart");
    expect(html).toContain("avc-table");
  });

  it("the drawings make no outside requests and need no scripts", async () => {
    const r = await buildSite(project(), [], { baseUrl: "https://example.com" });
    if (!r.ok) throw new Error("build failed");
    const html = dec.decode(r.files["index.html"]);
    for (const tag of html.match(/<svg[\s\S]*?<\/svg>/g) ?? []) {
      expect(tag).not.toMatch(/https?:|href=|xlink|<script|<image|<foreignObject|on\w+=/i);
    }
    expect(html).not.toContain("<script>alert");
  });
});
