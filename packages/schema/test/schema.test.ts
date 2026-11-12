import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyPatch, exampleProject, lintProject, structureSignature, validateProject, type Node, type Project } from "../src";

const p = (): Project => structuredClone(exampleProject);
const heading = (id: string): Node => ({ id, kind: "element", type: "heading", props: { text: "Hi", level: 2 } });

describe("validateProject", () => {
  it("accepts the example project", () => {
    const r = validateProject(exampleProject);
    expect(r.ok).toBe(true);
  });
  it("rejects unknown type, bad variant, disallowed style, bad url", () => {
    const bad = p();
    const hero = bad.pages[0]!.nodes[1]!.children![0]!;
    hero.variant = "nope";
    hero.styles = { base: { normal: { gap: "md" } } }; // layout group not allowed on hero
    hero.props.ctaHref = "javascript:alert(1)";
    const r = validateProject(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msgs = r.issues.map((i) => i.message).join("\n");
      expect(msgs).toMatch(/variant "nope"/);
      expect(msgs).toMatch(/style "gap"/);
      expect(msgs).toMatch(/url must be/);
    }
  });
  it("rejects non-section at top level and duplicate ids", () => {
    const bad = p();
    bad.pages[0]!.nodes.push(heading("hero1"));
    const r = validateProject(bad);
    expect(r.ok).toBe(false);
  });
});

describe("applyPatch", () => {
  it("insert / update / move / remove", () => {
    let proj = p();
    let r = applyPatch(proj, { summary: "add", ops: [{ op: "insert", parentId: "sec_features", index: 0, node: heading("h1") }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    proj = r.project;
    r = applyPatch(proj, { summary: "upd", ops: [{ op: "update", id: "h1", props: { text: "Yo" } }] });
    expect(r.ok && r.project.pages[0]!.nodes[2]!.children![0]!.props.text).toBe("Yo");
    if (!r.ok) return;
    r = applyPatch(r.project, { summary: "mv", ops: [{ op: "move", id: "h1", parentId: "sec_hero", index: 1 }] });
    expect(r.ok && r.project.pages[0]!.nodes[1]!.children!.map((c) => c.id)).toEqual(["hero1", "h1"]);
    if (!r.ok) return;
    r = applyPatch(r.project, { summary: "rm", ops: [{ op: "remove", id: "h1" }] });
    expect(r.ok).toBe(true);
  });

  it("is all-or-nothing and does not mutate the input", () => {
    const proj = p();
    const snapshot = JSON.stringify(proj);
    const r = applyPatch(proj, {
      summary: "bad",
      ops: [
        { op: "update", id: "hero1", props: { headline: "changed" } },
        { op: "remove", id: "missing" },
      ],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(proj)).toBe(snapshot);
  });

  it("null unsets a style key, and styles:null clears all", () => {
    let r = applyPatch(p(), { summary: "s", ops: [{ op: "update", id: "sec_hero", styles: { base: { normal: { padding: { top: null } } } } }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.project.pages[0]!.nodes[1]!.styles!;
    expect(st.base!.normal!.padding).toEqual({ bottom: "xl" });
    r = applyPatch(r.project, { summary: "c", ops: [{ op: "update", id: "sec_hero", styles: null }] });
    expect(r.ok && r.project.pages[0]!.nodes[1]!.styles).toBeUndefined();
  });

  it("rejects invalid results (child not allowed, bad style value)", () => {
    expect(applyPatch(p(), { summary: "x", ops: [{ op: "insert", parentId: "hero1", index: 0, node: heading("z") }] }).ok).toBe(false);
    expect(applyPatch(p(), { summary: "x", ops: [{ op: "update", id: "sec_hero", styles: { base: { normal: { opacity: 5 } } } }] }).ok).toBe(false);
  });

  it("forbids moving a node into its own descendant", () => {
    const proj = p();
    const wrap: Node = { id: "c1", kind: "container", type: "container", props: {}, children: [{ id: "c2", kind: "container", type: "container", props: {} }] };
    const r1 = applyPatch(proj, { summary: "w", ops: [{ op: "insert", parentId: "sec_features", index: 0, node: wrap }] });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyPatch(r1.project, { summary: "m", ops: [{ op: "move", id: "c1", parentId: "c2", index: 0 }] });
    expect(r2.ok).toBe(false);
  });

  it("scope guard confines element-prompt patches", () => {
    const outside = applyPatch(p(), { summary: "o", ops: [{ op: "update", id: "feat1", props: { title: "x" } }] }, { scope: "sec_hero" });
    expect(outside.ok).toBe(false);
    const inside = applyPatch(p(), { summary: "i", ops: [{ op: "update", id: "hero1", props: { headline: "x" } }] }, { scope: "sec_hero" });
    expect(inside.ok).toBe(true);
    const rm = applyPatch(p(), { summary: "r", ops: [{ op: "remove", id: "sec_hero" }] }, { scope: "sec_hero" });
    expect(rm.ok).toBe(false);
  });

  it("setTheme merges, validates, and is blocked under a node scope", () => {
    const r = applyPatch(p(), { summary: "t", ops: [{ op: "setTheme", theme: { colors: { primary: "#ff0000" }, motion: "off" } }] });
    expect(r.ok && r.project.theme.colors.primary).toBe("#ff0000");
    expect(r.ok && r.project.theme.colors.text).toBe("#111827");
    expect(applyPatch(p(), { summary: "t", ops: [{ op: "setTheme", theme: { colors: { primary: "red" } } }] }).ok).toBe(false);
    expect(applyPatch(p(), { summary: "t", ops: [{ op: "setTheme", theme: { motion: "off" } }] }, { scope: "sec_hero" }).ok).toBe(false);
  });

  it("enforces 1..20 ops", () => {
    expect(applyPatch(p(), { summary: "e", ops: [] }).ok).toBe(false);
  });
});

describe("structureSignature", () => {
  it("ignores text/styles but detects structural change", () => {
    const a = p();
    const sig = structureSignature(a.pages[0]!);
    const b = p();
    b.pages[0]!.nodes[1]!.children![0]!.props.headline = "Different copy";
    expect(structureSignature(b.pages[0]!)).toBe(sig);
    b.pages[0]!.nodes[1]!.children![0]!.variant = "centered";
    expect(structureSignature(b.pages[0]!)).not.toBe(sig);
  });
});

describe("property: random patches never yield an invalid project", () => {
  const ids = ["page_home", "sec_nav", "sec_hero", "sec_features", "sec_footer", "nav1", "hero1", "feat1", "foot1", "n1", "n2", "ghost"];
  const idArb = fc.constantFrom(...ids);
  const nodeArb: fc.Arbitrary<Node> = fc.record({
    id: fc.constantFrom("n1", "n2", "hero1"),
    kind: fc.constantFrom("element", "container", "block", "container") as fc.Arbitrary<Node["kind"]>,
    type: fc.constantFrom("heading", "container", "section", "hero", "bogus"),
    props: fc.constantFrom({}, { text: "t" }, { headline: "h" }),
  });
  const opArb = fc.oneof(
    fc.record({ op: fc.constant("insert" as const), parentId: idArb, index: fc.nat(4), node: nodeArb }),
    fc.record({ op: fc.constant("remove" as const), id: idArb }),
    fc.record({ op: fc.constant("move" as const), id: idArb, parentId: idArb, index: fc.nat(4) }),
    fc.record({ op: fc.constant("update" as const), id: idArb, props: fc.constantFrom({ text: "x" }, { headline: 3 }, {}) }),
  );
  it("result is either an error or a fully valid project", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 6 }), (ops) => {
        const r = applyPatch(p(), { summary: "fuzz", ops });
        if (r.ok) expect(validateProject(r.project).ok).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe("pages", () => {
  const page = (id: string, path: string) => ({ id, name: id, path, nodes: [] });
  it("add / update / remove page", () => {
    let r = applyPatch(p(), { summary: "a", ops: [{ op: "addPage", page: page("page_about", "/about") }] });
    expect(r.ok && r.project.pages.length).toBe(2);
    if (!r.ok) return;
    r = applyPatch(r.project, { summary: "u", ops: [{ op: "updatePage", id: "page_about", name: "About us", seo: { title: "About" } }] });
    expect(r.ok && r.project.pages[1]!.seo?.title).toBe("About");
    if (!r.ok) return;
    r = applyPatch(r.project, { summary: "r", ops: [{ op: "removePage", id: "page_about" }] });
    expect(r.ok && r.project.pages.length).toBe(1);
  });
  it("rejects duplicate path, duplicate id, last-page removal, scoped page ops", () => {
    expect(applyPatch(p(), { summary: "a", ops: [{ op: "addPage", page: page("x", "/") }] }).ok).toBe(false);
    expect(applyPatch(p(), { summary: "a", ops: [{ op: "addPage", page: page("hero1", "/z") }] }).ok).toBe(false);
    expect(applyPatch(p(), { summary: "r", ops: [{ op: "removePage", id: "page_home" }] }).ok).toBe(false);
    expect(applyPatch(p(), { summary: "a", ops: [{ op: "addPage", page: page("y", "/y") }] }, { scope: "sec_hero" }).ok).toBe(false);
  });
});

describe("lintProject", () => {
  it("flags missing alt, dead internal links, missing home", () => {
    const proj = p();
    proj.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { src: "https://x.test/a.png", alt: "", fit: "cover" } });
    proj.pages[0]!.nodes[0]!.children![0]!.props.links = [{ label: "Gone", href: "/nope" }];
    const msgs = lintProject(proj).map((i) => i.message).join("|");
    expect(msgs).toMatch(/no alt text/);
    expect(msgs).toMatch(/"\/nope"/);
    proj.pages[0]!.path = "/home";
    expect(lintProject(proj).some((i) => i.message.includes("No home page"))).toBe(true);
  });
  it("is clean for the example apart from SEO warnings", () => {
    expect(lintProject(p()).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("props null removes key", () => {
  it("clears an optional prop and still validates", () => {
    const proj = p();
    proj.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { src: "https://x.test/a.png", alt: "x", fit: "cover" } });
    const r = applyPatch(proj, { summary: "swap", ops: [{ op: "update", id: "im", props: { src: null, assetId: "a1" } }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.pages[0]!.nodes[1]!.children![1]!.props).toEqual({ alt: "x", fit: "cover", assetId: "a1" });
    // required props can't be removed
    expect(applyPatch(proj, { summary: "bad", ops: [{ op: "update", id: "im", props: { alt: null } }] }).ok).toBe(false);
  });
});

import { animMeta, effectiveTrigger, ANIMATIONS } from "../src";
describe("animation metadata", () => {
  it("every implemented preset is a valid schema preset", () => {
    for (const a of ANIMATIONS) expect(applyPatch(p(), { summary: "a", ops: [{ op: "update", id: "hero1", animation: { preset: a.preset } }] }).ok).toBe(true);
  });
  it("effectiveTrigger falls back to a valid trigger for the preset", () => {
    expect(effectiveTrigger({ preset: "fade-in" })).toBe("scroll");
    expect(effectiveTrigger({ preset: "fade-in", trigger: "load" })).toBe("load");
    expect(effectiveTrigger({ preset: "hover-lift", trigger: "scroll" })).toBe("hover");
    expect(effectiveTrigger({ preset: "pulse" })).toBe("load");
    expect(animMeta("lottie")).toBeUndefined(); // accepted by the schema, not implemented yet
    expect(animMeta("parallax")?.triggers).toEqual(["scroll"]);
    expect(effectiveTrigger({ preset: "marquee", trigger: "scroll" })).toBe("load");
  });
});

describe("embed allow-list (spec 15.1)", () => {
  const withEmbed = (provider: string, url: string) => {
    const proj = p();
    proj.pages[0]!.nodes[1]!.children!.push({ id: "em", kind: "element", type: "embed", props: { provider, url } });
    return validateProject(proj).ok;
  };
  it("accepts the allowed https embed addresses", () => {
    expect(withEmbed("youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
    expect(withEmbed("youtube", "https://www.youtube-nocookie.com/embed/abc")).toBe(true);
    expect(withEmbed("map", "https://www.google.com/maps/embed?pb=abc")).toBe(true);
    expect(withEmbed("map", "https://www.openstreetmap.org/export/embed.html?bbox=1")).toBe(true);
  });
  it("rejects everything else, including look-alike hosts, other paths, http, credentials and mismatched providers", () => {
    for (const [prov, url] of [
      ["youtube", "https://evil.example.com/embed/x"],
      ["youtube", "https://www.youtube.com.evil.com/embed/x"],
      ["youtube", "https://www.youtube.com/watch?v=x"],
      ["youtube", "http://www.youtube.com/embed/x"],
      ["youtube", "https://user:pw@www.youtube.com/embed/x"],
      ["youtube", "https://www.youtube.com:8443/embed/x"],
      ["youtube", "https://www.google.com/maps/embed?pb=x"],
      ["map", "https://www.google.com/search?q=x"],
      ["map", "https://maps.evil.com/maps/embed"],
      ["map", "/maps/embed"],
    ] as const) expect(withEmbed(prov, url), `${prov} ${url}`).toBe(false);
  });
});

describe("new blocks", () => {
  const add = (node: Node) => {
    const proj = p();
    proj.pages[0]!.nodes[2]!.children!.push(node);
    return validateProject(proj);
  };
  const block = (type: string, variant: string, props: Record<string, unknown>): Node => ({ id: `n_${type}`, kind: "block", type, variant, props });
  const good: Record<string, [string, Record<string, unknown>]> = {
    stats: ["row", { items: [{ value: "500+", label: "Students" }] }],
    steps: ["vertical", { items: [{ title: "One", body: "First" }, { title: "Two", body: "Second" }] }],
    faq: ["simple", { items: [{ question: "Q?", answer: "A." }] }],
    pricing: ["cards", { plans: [{ name: "Pro", price: "₹999", period: "month", features: ["A", "B"], ctaLabel: "Buy", ctaHref: "/contact", highlighted: true }] }],
    team: ["cards", { members: [{ name: "Asha", role: "Maths", bio: "Teacher", imageAssetId: "asset_x" }] }],
    logoStrip: ["simple", { logos: [{ name: "Acme" }, { name: "Globex", imageAssetId: "asset_y" }] }],
    ctaBanner: ["primary", { headline: "Join", ctaLabel: "Go", ctaHref: "/contact" }],
    gallery: ["grid", { images: [{ assetId: "asset_z", alt: "A photo" }, { src: "https://x.test/a.jpg", alt: "Remote" }] }],
  };
  it("accepts well-formed props for every new block", () => {
    for (const [type, [variant, props]] of Object.entries(good)) {
      const r = add(block(type, variant, props));
      expect(r.ok ? [] : r.issues, type).toEqual([]);
    }
  });
  it("rejects bad variants, empty lists, too many items, unknown props and unsafe links", () => {
    expect(add(block("stats", "nope", good.stats![1])).ok).toBe(false);
    expect(add(block("stats", "row", { items: [] })).ok).toBe(false);
    expect(add(block("steps", "vertical", { items: [{ title: "Only one", body: "x" }] })).ok).toBe(false); // needs at least 2
    expect(add(block("pricing", "cards", { plans: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, price: "1", features: [] })) })).ok).toBe(false);
    expect(add(block("faq", "simple", { items: [{ question: "Q", answer: "A", extra: 1 }] })).ok).toBe(false);
    expect(add(block("ctaBanner", "primary", { headline: "x", ctaLabel: "Go", ctaHref: "javascript:alert(1)" })).ok).toBe(false);
    expect(add(block("pricing", "cards", { plans: [{ name: "P", price: "1", features: [], ctaHref: "javascript:alert(1)" }] })).ok).toBe(false);
    expect(add(block("gallery", "grid", { images: [{ alt: "no file" }] })).ok).toBe(false); // needs a file or address
    expect(add(block("gallery", "grid", { images: [{ src: "javascript:alert(1)", alt: "x" }] })).ok).toBe(false);
  });
  it("blocks cannot have children", () => {
    expect(add({ ...block("stats", "row", good.stats![1]), children: [{ id: "c", kind: "element", type: "text", props: { text: "x" } }] }).ok).toBe(false);
  });
});

describe("asset ids inside block arrays are tracked", () => {
  it("collectAssetIds finds gallery, team and logo images; lint checks them against the library and requires gallery alt text", async () => {
    const { collectAssetIds, lintProject } = await import("../src");
    const proj = p();
    proj.pages[0]!.nodes[2]!.children!.push(
      { id: "g", kind: "block", type: "gallery", variant: "grid", props: { images: [{ assetId: "ga", alt: "A" }, { assetId: "gb", alt: "" }] } },
      { id: "t", kind: "block", type: "team", variant: "cards", props: { members: [{ name: "N", imageAssetId: "tm" }] } },
      { id: "l", kind: "block", type: "logoStrip", variant: "simple", props: { logos: [{ name: "L", imageAssetId: "lg" }] } },
    );
    expect([...collectAssetIds(proj)].sort()).toEqual(["ga", "gb", "lg", "tm"]);
    const msgs = lintProject(proj, { assetIds: new Set(["ga"]) }).map((i) => i.message).join("|");
    expect(msgs).toMatch(/media library/);
    expect(msgs).toMatch(/gallery.*no alt text/);
    expect(lintProject(proj, { assetIds: new Set(["ga", "gb", "tm", "lg"]) }).some((i) => i.message.includes("media library"))).toBe(false);
  });
});
