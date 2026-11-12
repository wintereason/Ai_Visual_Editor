import { describe, expect, it } from "vitest";
import { exampleProject, lintProject, validateProject, type Node, type Project } from "@avc/schema";
import { LEGAL_PAGES, legalPage, type LegalInput, type LegalKind } from "@avc/templates";
import { buildSite } from "../src";

const input: LegalInput = { business: "BrightPath Coaching", email: "hello@brightpath.example", country: "India", hasForm: true, hasAnalytics: false, date: "10 November 2026" };
let n = 0;
const nid = () => `lg${++n}`;
const KINDS = Object.keys(LEGAL_PAGES) as LegalKind[];
const flat = (nodes: Node[]): Node[] => nodes.flatMap((x) => [x, ...flat(x.children ?? [])]);
const texts = (nodes: Node[]) => flat(nodes).map((x) => String((x.props as any).text ?? ""));

const withLegal = (kind: LegalKind, over: Partial<LegalInput> = {}): Project => {
  const p = structuredClone(exampleProject);
  p.pages.push(legalPage(kind, { ...input, ...over }, `pg_${kind}`, nid));
  return p;
};
/** What a careful author does: fills the blanks and deletes the notice. */
function reviewed(p: Project): Project {
  const q = structuredClone(p);
  const fix = (nodes: Node[]): Node[] =>
    nodes.filter((x) => !x.id.startsWith("legal_notice")).map((x) => ({
      ...x,
      props: JSON.parse(JSON.stringify(x.props).replace(/\[\[[^\]]*\]\]/g, "30")),
      children: x.children ? fix(x.children) : undefined,
    })) as Node[];
  for (const pg of q.pages) pg.nodes = fix(pg.nodes);
  return q;
}

describe("legal page generator", () => {
  for (const kind of KINDS) {
    it(`${kind}: a valid page with the business details filled in and the right path`, () => {
      const p = withLegal(kind);
      expect(validateProject(p).ok).toBe(true);
      const page = p.pages.find((x) => x.id === `pg_${kind}`)!;
      expect(page.path).toBe(LEGAL_PAGES[kind].path);
      const all = texts(page.nodes).join("\n");
      expect(all).toContain("BrightPath Coaching");
      expect(all).toContain("hello@brightpath.example");
      expect(page.seo?.title).toBe(LEGAL_PAGES[kind].name);
      expect(flat(page.nodes).filter((x) => x.type === "heading" && (x.props as any).level === 1)).toHaveLength(1);
    });
  }
  it("node ids are unique", () => {
    const p = withLegal("privacy");
    const ids = flat(p.pages.flatMap((x) => x.nodes)).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("the privacy policy says what is actually true: form on/off, analytics on/off", () => {
    const get = (o: Partial<LegalInput>) => texts(withLegal("privacy", o).pages.at(-1)!.nodes).join("\n");
    expect(get({ hasForm: true })).toContain("contact form");
    expect(get({ hasForm: false })).toContain("does not collect personal information");
    expect(get({ hasAnalytics: true })).toContain("analytics service");
    expect(get({ hasAnalytics: false })).toContain("do not run website analytics");
  });
  it("uses the given country for the governing law, and blank placeholders when details are missing", () => {
    expect(texts(withLegal("terms", { country: "Nepal" }).pages.at(-1)!.nodes).join("\n")).toContain("laws of Nepal");
    const missing = texts(withLegal("privacy", { business: "  ", email: "" }).pages.at(-1)!.nodes).join("\n");
    expect(missing).toContain("[[your business name]]");
    expect(missing).toContain("[[your email address]]");
  });
  it("cleans hostile input: control characters, whitespace runs and absurd lengths", () => {
    const t = texts(withLegal("privacy", { business: "A\u0000B\n\n   C" + "x".repeat(500), address: "<script>alert(1)</script>" }).pages.at(-1)!.nodes).join("\n");
    expect(t).not.toMatch(/\u0000/);
    expect(t).toContain("A B C");
    expect(t.length).toBeLessThan(6000);
  });
});

describe("starter text cannot be published by accident", () => {
  for (const kind of KINDS) {
    it(`${kind}: the pre-publish check blocks it, and the build refuses`, async () => {
      const p = withLegal(kind);
      const errors = lintProject(p).filter((i) => i.severity === "error").map((i) => i.message);
      expect(errors.some((m) => m.includes("starter-text notice"))).toBe(true);
      expect(errors.some((m) => m.includes("blanks to fill in") || kind === "terms" || kind === "privacy" || kind === "refunds")).toBe(true);
      const r = await buildSite(p, []);
      expect(r.ok).toBe(false);
    });
  }
  it("deleting only the notice is not enough while blanks remain", async () => {
    const p = withLegal("privacy");
    for (const pg of p.pages) for (const sec of pg.nodes) sec.children = sec.children?.filter((c) => !c.id.startsWith("legal_notice")) ?? sec.children;
    const errors = lintProject(p).filter((i) => i.severity === "error").map((i) => i.message);
    expect(errors.some((m) => m.includes("starter-text notice"))).toBe(false);
    expect(errors.some((m) => m.includes("blanks to fill in"))).toBe(true);
    expect((await buildSite(p, [])).ok).toBe(false);
  });
  it("filling the blanks is not enough while the notice remains", async () => {
    const p = withLegal("terms");
    const q = JSON.parse(JSON.stringify(p).replace(/\[\[[^\]]*\]\]/g, "30")) as Project;
    const errors = lintProject(q).filter((i) => i.severity === "error").map((i) => i.message);
    expect(errors.some((m) => m.includes("blanks"))).toBe(false);
    expect(errors.some((m) => m.includes("starter-text notice"))).toBe(true);
  });
  it("once reviewed (blanks filled, notice deleted) all three pages build and are published", async () => {
    const p = structuredClone(exampleProject);
    for (const k of KINDS) p.pages.push(legalPage(k, input, `pg_${k}`, nid));
    const r = await buildSite(reviewed(p), [], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of KINDS) {
      const html = new TextDecoder().decode(r.files[`${LEGAL_PAGES[k].path.slice(1)}/index.html`]);
      expect(html).toContain(LEGAL_PAGES[k].name);
      expect(html).not.toContain("STARTER TEXT");
      expect(html).not.toMatch(/\[\[/);
    }
  });
  it("blanks are caught anywhere in a page, not only in legal pages", () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children![0]!.props = { ...p.pages[0]!.nodes[1]!.children![0]!.props, headline: "Welcome to [[your name]]" } as never;
    expect(lintProject(p).some((i) => i.severity === "error" && i.message.includes("blanks"))).toBe(true);
  });
});
