import { describe, expect, it } from "vitest";
import { exampleProject, validateProject, type Node, type Project } from "@avc/schema";
import { renderDocument, renderPage } from "../src";

const block = (type: string, variant: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({ id: `b_${type}`, kind: "block", type, variant, props, ...extra });
const withBlock = (node: Node): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[2]!.children!.push(node);
  return p;
};
const html = (node: Node, assets: Record<string, string> = {}) => {
  const p = withBlock(node);
  const v = validateProject(p);
  if (!v.ok) throw new Error(v.issues.map((i) => i.message).join());
  return renderPage(p, "page_home", { assetUrl: (id) => assets[id] }).html;
};
const EVIL = `<img onerror=1>"'&`; // short enough for the 20-character fields (value, price, period)

describe("new blocks", () => {
  it("stats", () => {
    const h = html(block("stats", "cards", { title: "Numbers", items: [{ value: "500+", label: "Students" }, { value: "92%", label: "Pass rate" }] }));
    expect(h).toContain("<strong>500+</strong><span>Students</span>");
    expect(h).toContain("avc-stats-cards");
    expect(h).toContain("<h2>Numbers</h2>");
  });
  it("steps are an ordered list with numbered badges", () => {
    const h = html(block("steps", "vertical", { items: [{ title: "Apply", body: "Fill the form" }, { title: "Visit", body: "Tour" }] }));
    expect(h).toContain("<ol");
    expect(h).toContain('avc-steps-vertical');
    expect(h).toMatch(/avc-step-n[^>]*>1<[\s\S]*avc-step-n[^>]*>2</);
  });
  it("faq uses native details/summary, so it works without JavaScript", () => {
    const h = html(block("faq", "simple", { items: [{ question: "Is it free?", answer: "Yes." }] }));
    expect(h).toContain("<details><summary>Is it free?</summary><p>Yes.</p></details>");
    expect(h).not.toContain("<script");
  });
  it("pricing highlights one plan and links its button", () => {
    const h = html(block("pricing", "cards", { plans: [
      { name: "Basic", price: "₹299", period: "month", features: ["One"], ctaLabel: "Start", ctaHref: "/contact" },
      { name: "Pro", price: "₹999", features: ["One", "Two"], highlighted: true, ctaLabel: "Go", ctaHref: "/contact" },
    ] }));
    expect(h.match(/avc-plan-hl/g)).toHaveLength(1);
    expect(h).toContain("<strong>₹299</strong><span> / month</span>");
    expect(h).toContain('<a class="avc-btn" href="/contact">Go</a>');
  });
  it("team shows an initial when there is no photo, and the photo when there is one", () => {
    const h = html(block("team", "cards", { members: [{ name: "asha", role: "Maths" }, { name: "Ravi", imageAssetId: "a1" }] }), { a1: "blob:x/1" });
    expect(h).toContain('aria-hidden="true">A</div>');
    expect(h).toContain('<img src="blob:x/1" alt="Ravi"');
  });
  it("logo strip falls back to the name as text", () => {
    const h = html(block("logoStrip", "simple", { logos: [{ name: "Acme" }, { name: "Globex", imageAssetId: "g" }] }), { g: "blob:x/g" });
    expect(h).toContain("<span>Acme</span>");
    expect(h).toContain('<img src="blob:x/g" alt="Globex"');
  });
  it("cta banner", () => {
    const h = html(block("ctaBanner", "primary", { headline: "Join us", subheadline: "Today", ctaLabel: "Apply", ctaHref: "/contact" }));
    expect(h).toContain("avc-cta-primary");
    expect(h).toContain('<a class="avc-btn avc-btn-light" href="/contact">Apply</a>');
  });
  it("gallery resolves uploaded files, keeps remote https images, lazy-loads, and skips unresolved ones", () => {
    const h = html(block("gallery", "grid", { images: [{ assetId: "ok", alt: "One" }, { src: "https://x.test/a.jpg", alt: "Two" }, { assetId: "missing", alt: "Three" }] }), { ok: "blob:x/ok" });
    expect(h).toContain('src="blob:x/ok"');
    expect(h).toContain('src="https://x.test/a.jpg"');
    expect(h).toContain('loading="lazy"');
    expect(h).not.toContain('alt="Three"'); // an image that cannot be resolved renders nothing rather than a broken icon
  });

  it("every piece of text in every block is escaped (no markup injection)", () => {
    const nodes: Node[] = [
      block("stats", "row", { title: EVIL, items: [{ value: EVIL, label: EVIL }] }),
      block("steps", "vertical", { title: EVIL, items: [{ title: EVIL, body: EVIL }, { title: "b", body: "b" }] }),
      block("faq", "simple", { title: EVIL, items: [{ question: EVIL, answer: EVIL }] }),
      block("pricing", "cards", { title: EVIL, plans: [{ name: EVIL, price: EVIL, period: EVIL, features: [EVIL], ctaLabel: EVIL, ctaHref: "/x" }] }),
      block("team", "cards", { title: EVIL, members: [{ name: EVIL, role: EVIL, bio: EVIL }] }),
      block("logoStrip", "simple", { title: EVIL, logos: [{ name: EVIL }] }),
      block("ctaBanner", "primary", { headline: EVIL, subheadline: EVIL, ctaLabel: EVIL, ctaHref: "/x" }),
      block("gallery", "grid", { title: EVIL, images: [{ src: "https://x.test/a.jpg", alt: EVIL }] }),
    ];
    for (const n of nodes) {
      const h = html(n);
      expect(h, n.type).not.toMatch(/<img onerror/);
      expect(h, n.type).toContain("&lt;img onerror=1&gt;");
    }
  });
});

describe("text and style animations", () => {
  const anim = (preset: string, type: "heading" | "text" = "heading", extra: Record<string, unknown> = {}) => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[2]!.children!.push({ id: "t", kind: "element", type, props: type === "heading" ? { text: "Learn skills fast", level: 2 } : { text: "Learn skills fast" }, animation: { preset: preset as never, ...extra } });
    return renderPage(p, "page_home");
  };

  it("word-by-word wraps every word in an indexed span; the words are escaped", () => {
    const r = anim("word-by-word");
    expect(r.html).toContain('<span class="avc-w" style="--i:0">Learn</span>');
    expect(r.html).toContain('<span class="avc-w" style="--i:2">fast</span>');
    expect(r.html).toContain('data-anim="word-by-word"');
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[2]!.children!.push({ id: "t", kind: "element", type: "text", props: { text: "<b>bold</b> move" }, animation: { preset: "word-by-word" } });
    expect(renderPage(p, "page_home").html).not.toContain("<b>");
  });
  it("other presets leave the text un-split", () => {
    expect(anim("fade-in").html).not.toContain("avc-w");
    expect(anim("typewriter").html).toContain("Learn skills fast");
  });
  it("every new preset has CSS, and typewriter/word-by-word hide pre-reveal content only when JS is running", () => {
    const css = anim("typewriter").css;
    for (const needle of ['[data-anim="typewriter"]', "@keyframes avc-type", "@keyframes avc-reveal", '[data-anim="hover-tilt"]:hover', '[data-anim="shimmer"]', "@keyframes avc-shimmer", '[data-anim="word-by-word"] .avc-w']) expect(css, needle).toContain(needle);
    expect(css).toContain('.avc-js [data-trigger="scroll"][data-anim="typewriter"]:not(.avc-in){max-width:0}');
    // every pre-reveal hide rule is scoped under .avc-js, so a page without JavaScript stays fully visible
    const hides = css.match(/[^}]*:not\(\.avc-in\)(?: \.avc-w)?\{(?:max-width:0|opacity:0)\}/g) ?? [];
    expect(hides.length).toBeGreaterThan(0);
    expect(hides.every((rule) => rule.trimStart().startsWith(".avc-js "))).toBe(true);
  });
  it("reduced motion turns all of them off and restores full visibility", () => {
    const css = anim("shimmer").css;
    expect(css).toContain("prefers-reduced-motion:reduce");
    const tail = css.slice(css.indexOf("prefers-reduced-motion:reduce"));
    expect(tail).toContain("animation:none!important");
    expect(tail).toContain("max-width:none!important");
    expect(tail).toContain("clip-path:none!important");
    expect(tail).toContain('[data-anim] .avc-w{animation:none!important;opacity:1!important}');
    expect(tail).toContain('[data-anim="shimmer"]{color:inherit!important;background:none!important}');
  });
  it("a scroll-triggered typewriter or word-by-word includes the reveal script; a load-triggered one does not", () => {
    const doc = (preset: string, trigger: "scroll" | "load") => {
      const p = structuredClone(exampleProject);
      p.pages[0]!.nodes[2]!.children!.push({ id: "t", kind: "element", type: "heading", props: { text: "Hi there", level: 2 }, animation: { preset: preset as never, trigger } });
      return renderDocument(p, "page_home");
    };
    expect(doc("typewriter", "scroll")).toContain("IntersectionObserver");
    expect(doc("word-by-word", "scroll")).toContain("IntersectionObserver");
    expect(doc("typewriter", "load")).not.toContain("<script");
  });
});
