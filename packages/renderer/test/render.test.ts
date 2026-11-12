import { describe, expect, it } from "vitest";
import { exampleProject } from "@avc/schema";
import { nodeCss, renderDocument, renderPage } from "../src";

describe("css cascade", () => {
  it("emits base, hover, then mobile media query", () => {
    const css = nodeCss("x", {
      base: { normal: { padding: { top: "xl" } }, hover: { opacity: 0.5 } },
      mobile: { normal: { padding: { top: "md" } } },
    });
    expect(css).toBe(".x{padding:48px 0 0 0}.x:hover{opacity:0.5}@media (max-width:640px){.x{padding:16px 0 0 0}}");
  });
  it("resolves theme colors to variables", () => {
    expect(nodeCss("x", { base: { normal: { color: "theme.primary" } } })).toContain("var(--c-primary)");
  });
});

describe("renderPage", () => {
  const r = renderPage(exampleProject, "page_home");
  it("renders content and per-node responsive css", () => {
    expect(r.html).toContain("Learn skills that get you hired");
    expect(r.html).toContain('data-anim="fade-in"');
    expect(r.css).toContain("@media (max-width:640px){.n-sec_hero{padding:16px 0 16px 0}}");
  });
  it("escapes text", () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children![0]!.props.headline = "<script>alert(1)</script>";
    expect(renderPage(p, "page_home").html).not.toContain("<script>");
  });
  it("produces a full document", () => {
    expect(renderDocument(exampleProject, "page_home")).toMatch(/^<!doctype html>/);
  });
});

describe("renderSite", () => {
  it("emits one file per page with clean paths", async () => {
    const { renderSite, pageFile } = await import("../src");
    expect(pageFile("/")).toBe("index.html");
    expect(pageFile("/courses/")).toBe("courses/index.html");
    const p = structuredClone(exampleProject);
    p.pages.push({ id: "page_c", name: "Courses", path: "/courses", nodes: [] });
    expect(Object.keys(renderSite(p)).sort()).toEqual(["courses/index.html", "index.html"]);
  });
});

describe("assets", () => {
  const url = (id: string) => (id === "a1" ? "blob:http://x/abc" : undefined);
  it("resolves image, hero and background assets; leaves unresolved empty", () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { assetId: "a1", alt: "Pic", fit: "cover" } });
    p.pages[0]!.nodes[1]!.children![0]!.props.imageAssetId = "a1";
    p.pages[0]!.nodes[2]!.styles = { base: { normal: { background: { assetId: "a1", fit: "cover", overlay: 0.4 } } } };
    const r = renderPage(p, "page_home", { assetUrl: url });
    expect(r.html).toContain('src="blob:http://x/abc"');
    expect(r.html).toContain("avc-hero-img");
    expect(r.css).toContain('url("blob:http://x/abc") center/cover');
    expect(r.css).toContain("rgba(0,0,0,0.4)");
    const missing = renderPage(p, "page_home", { assetUrl: () => undefined });
    expect(missing.html).not.toContain("avc-hero-img");
  });
  it("never emits unsafe URLs", async () => {
    const { safeCssUrl } = await import("../src");
    expect(safeCssUrl("javascript:alert(1)")).toBeNull();
    expect(safeCssUrl("data:text/html,x")).toBeNull();
    const u = safeCssUrl('https://x.test/a")</style><script>b("')!;
    expect(u).not.toMatch(/["()<>]/);
  });
});

describe("animation runtime", () => {
  const withAnim = (anim: any, motion: "off" | "subtle" | "full" = "subtle") => {
    const p = structuredClone(exampleProject);
    p.theme.motion = motion;
    p.pages[0]!.nodes[1]!.children![0]!.animation = anim;
    return p;
  };
  it("emits data-trigger using the effective trigger", () => {
    expect(renderPage(withAnim({ preset: "fade-in" }), "page_home").html).toContain('data-trigger="scroll"');
    expect(renderPage(withAnim({ preset: "fade-in", trigger: "load" }), "page_home").html).toContain('data-trigger="load"');
    expect(renderPage(withAnim({ preset: "hover-lift", trigger: "scroll" }), "page_home").html).toContain('data-trigger="hover"');
  });
  it("includes the reveal script only when something is scroll-triggered", () => {
    expect(renderDocument(withAnim({ preset: "slide-up" }), "page_home")).toContain("IntersectionObserver");
    expect(renderDocument(withAnim({ preset: "slide-up", trigger: "load" }), "page_home")).not.toContain("<script>");
    expect(renderDocument(withAnim(undefined), "page_home")).not.toContain("<script>");
  });
  it("only hides pre-reveal content when JS is running (.avc-js), and honours reduced motion", () => {
    const css = renderPage(withAnim({ preset: "fade-in" }), "page_home").css;
    expect(css).toContain('.avc-js [data-trigger="scroll"][data-anim="fade-in"]:not(.avc-in){opacity:0}');
    // every pre-reveal hide rule must be scoped under .avc-js
    const hides = css.match(/[^}]*:not\(\.avc-in\)\{opacity:0\}/g) ?? [];
    expect(hides.length).toBeGreaterThan(0);
    expect(hides.every((r) => r.trimStart().startsWith(".avc-js "))).toBe(true);
    expect(css).toContain("prefers-reduced-motion:reduce");
  });
  it('theme motion "off" removes all animation attributes and the script', () => {
    const p = withAnim({ preset: "fade-in" }, "off");
    expect(renderPage(p, "page_home").html).not.toContain("data-anim");
    expect(renderDocument(p, "page_home")).not.toContain("<script>");
  });
  it("script contains no interpolated project content", () => {
    const p = withAnim({ preset: "fade-in" });
    p.pages[0]!.nodes[1]!.children![0]!.props.headline = "</script><script>evil()</script>";
    const doc = renderDocument(p, "page_home");
    expect(doc.match(/<script>/g)?.length).toBe(1);
    expect(doc).not.toContain("<script>evil()");
  });
});
