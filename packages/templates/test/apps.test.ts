import { describe, expect, it } from "vitest";
import { failingPairs, lintProject, validateProject } from "@avc/schema";
import { renderSite } from "@avc/renderer";
import { buildSite } from "@avc/publisher";
import { APP_TEMPLATES, TEMPLATES } from "../src";

const PNG = (n: number) => { const b = new Uint8Array(40); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, n); new DataView(b.buffer).setUint32(20, n); return b; };

describe("the starter apps", () => {
  it("are kept apart from the website templates (so mixing pages is unaffected)", () => {
    expect(APP_TEMPLATES.length).toBeGreaterThanOrEqual(2);
    for (const t of APP_TEMPLATES) expect(TEMPLATES.some((w) => w.id === t.id)).toBe(false);
    expect(APP_TEMPLATES.every((t) => t.platform === "mobile")).toBe(true);
  });

  for (const t of APP_TEMPLATES) {
    describe(t.title, () => {
      const p = t.make();
      it("is a valid mobile project with no errors and readable colours", () => {
        expect(validateProject(p).ok).toBe(true);
        expect(p.platform).toBe("mobile");
        expect(lintProject(p).filter((i) => i.severity === "error")).toEqual([]);
        expect(failingPairs(p.theme.colors)).toEqual([]);
      });
      it("every internal link goes to a real screen", () => {
        expect(lintProject(p).filter((i) => /doesn't exist/.test(i.message))).toEqual([]);
      });
      it("every screen has a header, content and the same tab bar, with the current tab marked", () => {
        const site = renderSite(p);
        for (const pg of p.pages) {
          const file = pg.path === "/" ? "index.html" : `${pg.path.slice(1)}/index.html`;
          const html = site[file]!;
          expect(html, pg.path).toContain("avc-ah");
          expect(html, pg.path).toContain("avc-tabbar");
          const on = [...html.matchAll(/class="avc-tab avc-tab-on" href="([^"]*)"/g)].map((m) => m[1]);
          expect(on, pg.path).toEqual([pg.path]);
        }
      });
      it("has a screen you can reach from the tab bar for each tab, and 4 tabs", () => {
        const tab = JSON.stringify(p.pages[0]!.nodes);
        const tabs = JSON.parse(/"type":"tabBar".*?"items":(\[.*?\])/.exec(tab)![1]!);
        expect(tabs).toHaveLength(4);
        for (const it of tabs) expect(p.pages.some((pg) => pg.path === it.href)).toBe(true);
      });
      it("publishes as an installable app: manifest with its name, offline worker, and no errors", async () => {
        const r = await buildSite(p, [], { baseUrl: "https://app.example.com", app: { icons: [{ size: 192, bytes: PNG(192) }, { size: 512, bytes: PNG(512) }] } });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const m = JSON.parse(new TextDecoder().decode(r.files["manifest.webmanifest"]));
        expect(m.name).toBe(p.name);
        expect(m.short_name).toBe(p.app!.shortName);
        expect(r.files["sw.js"]).toBeDefined();
        expect(r.manifest.warnings.filter((w) => /tab bar|icon/.test(w))).toEqual([]);
      });
    });
  }
});
