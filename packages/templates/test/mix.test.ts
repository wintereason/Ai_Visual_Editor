import { describe, expect, it } from "vitest";
import { failingPairs, lintProject, validateProject, type Node, type Project } from "@avc/schema";
import { renderSite } from "@avc/renderer";
import { mixTemplates, TEMPLATES, type PageRef } from "../src";

const ids = () => { let n = 0; return () => `m_${++n}`; };
const page = (templateId: string, path: string): PageRef => {
  const t = TEMPLATES.find((x) => x.id === templateId)!.make();
  return { templateId, pageId: t.pages.find((p) => p.path === path)!.id };
};
const okMix = (refs: PageRef[], themeFrom: string): Project => {
  const r = mixTemplates(refs, themeFrom, ids());
  if (!r.ok) throw new Error("mix failed: " + r.error);
  return r.project;
};
const nodes = (p: Project) => {
  const out: Node[] = [];
  const walk = (ns: Node[]) => ns.forEach((n) => { out.push(n); if (n.children) walk(n.children); });
  p.pages.forEach((pg) => walk(pg.nodes));
  return out;
};

describe("mixTemplates", () => {
  it("builds one valid, lint-clean, renderable site from pages of different templates", () => {
    const p = okMix([page("school", "/"), page("coaching", "/courses"), page("college", "/admissions"), page("online", "/contact")], "school");
    expect(validateProject(p).ok).toBe(true);
    expect(lintProject(p).filter((i) => i.severity === "error")).toEqual([]);
    expect(p.pages.map((x) => x.path)).toEqual(["/", "/courses", "/admissions", "/contact"]);
    expect(Object.keys(renderSite(p))).toHaveLength(4);
  });

  it("uses the chosen template's theme and name, and its colors pass contrast", () => {
    const green = okMix([page("coaching", "/"), page("school", "/about")], "school");
    const school = TEMPLATES.find((t) => t.id === "school")!.make();
    expect(green.theme).toEqual(school.theme);
    expect(green.name).toBe(school.name);
    expect(failingPairs(green.theme.colors)).toEqual([]);
  });

  it("one brand everywhere: navbars, footers and page titles carry the chosen name, and no other template's name survives", () => {
    const refs = [page("coaching", "/"), page("college", "/admissions"), page("preschool", "/contact")];
    const p = okMix(refs, "online");
    const brand = TEMPLATES.find((t) => t.id === "online")!.make().name;
    for (const n of nodes(p)) {
      if (n.type === "navbar") expect(n.props.brand).toBe(brand);
      if (n.type === "footer") expect(String(n.props.copyright)).toContain(brand);
    }
    for (const pg of p.pages) if (pg.seo?.title?.includes(" | ")) expect(pg.seo.title.endsWith(` | ${brand}`)).toBe(true);
    const text = JSON.stringify(p);
    for (const other of ["BrightPath Academy", "Northbridge College", "Little Sprouts Preschool"]) expect(text, other).not.toContain(other);
  });

  it("navigation lists exactly the chosen pages, home first, with working paths", () => {
    const p = okMix([page("school", "/contact"), page("coaching", "/courses"), page("college", "/")], "coaching");
    const expected = [{ label: "Home", href: "/" }, { label: "Contact", href: "/contact" }, { label: "Courses", href: "/courses" }];
    expect(p.pages.map((x) => x.path)).toEqual(["/", "/contact", "/courses"]);
    for (const n of nodes(p)) if (n.type === "navbar" || n.type === "footer") expect(n.props.links).toEqual(expected);
  });

  it("links to pages that are not in the mix are redirected, so the result has no dead internal links", () => {
    // coaching's Home links to /contact and /courses; with only Home chosen, they must go somewhere that exists
    const p = okMix([page("coaching", "/")], "coaching");
    expect(lintProject(p).filter((i) => i.message.includes("doesn't exist"))).toEqual([]);
    for (const n of nodes(p)) {
      const hrefs = [n.props.href, n.props.ctaHref, ...(((n.props.links as { href: string }[]) ?? []).map((l) => l.href))].filter((h): h is string => typeof h === "string" && h.startsWith("/"));
      for (const h of hrefs) expect(p.pages.some((pg) => pg.path === h.split(/[?#]/)[0]), h).toBe(true);
    }
  });

  it("repairs pricing-plan buttons too, and prefers /contact, then the first other page", () => {
    const p = okMix([page("online", "/"), page("online", "/pricing")], "online"); // no /contact page chosen
    const plans = nodes(p).find((n) => n.type === "pricing")!.props.plans as { ctaHref?: string }[];
    for (const pl of plans) expect(["/", "/pricing"]).toContain(pl.ctaHref);
    const withContact = okMix([page("online", "/"), page("online", "/pricing"), page("school", "/contact")], "online");
    const cta = nodes(withContact).find((n) => n.type === "pricing")!.props.plans as { ctaHref?: string }[];
    expect(cta.some((pl) => pl.ctaHref === "/contact")).toBe(true);
  });

  it("every pair of templates mixes cleanly (home from one, a page from the other)", () => {
    for (const a of TEMPLATES) for (const b of TEMPLATES) {
      const bPages = b.make().pages.filter((p) => p.path !== "/");
      for (const bp of bPages) {
        const r = mixTemplates([page(a.id, "/"), { templateId: b.id, pageId: bp.id }], a.id, ids());
        expect(r.ok, `${a.id}+${b.id}${bp.path}`).toBe(true);
        if (r.ok) expect(lintProject(r.project).filter((i) => i.severity === "error"), `${a.id}+${b.id}${bp.path}`).toEqual([]);
      }
    }
  });

  it("rejects two pages at the same path, a mix with no home page, an empty mix, and unknown templates or pages", () => {
    const dup = mixTemplates([page("school", "/contact"), page("coaching", "/contact"), page("school", "/")], "school", ids());
    expect(dup).toMatchObject({ ok: false });
    expect((dup as { error: string }).error).toMatch(/both live at "\/contact"/);
    expect((mixTemplates([page("school", "/about")], "school", ids()) as { error: string }).error).toMatch(/home page/);
    expect((mixTemplates([], "school", ids()) as { error: string }).error).toMatch(/at least one/);
    expect((mixTemplates([page("school", "/")], "nope", ids()) as { error: string }).error).toMatch(/colors and fonts/);
    expect((mixTemplates([{ templateId: "ghost", pageId: "x" }], "school", ids()) as { error: string }).error).toMatch(/no longer exists/);
    expect((mixTemplates([{ templateId: "school", pageId: "page_nope" }], "school", ids()) as { error: string }).error).toMatch(/no longer exists/);
  });

  it("gives every page and node a fresh, unique id and never touches the source templates", () => {
    const before = JSON.stringify(TEMPLATES.map((t) => t.make()));
    const p = okMix([page("school", "/"), page("coaching", "/courses")], "school");
    const all = [p.id, ...p.pages.map((x) => x.id), ...nodes(p).map((n) => n.id)];
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((x) => x.startsWith("m_"))).toBe(true); // none of the template's own ids leaked
    expect(JSON.stringify(TEMPLATES.map((t) => t.make()))).toBe(before);
  });

  it("is deterministic for the same input", () => {
    const refs = [page("school", "/"), page("online", "/pricing")];
    expect(JSON.stringify(okMix(refs, "online"))).toBe(JSON.stringify(okMix(refs, "online")));
  });
});

describe("template metadata", () => {
  it("every template has searchable tags and a unique id", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) expect(t.tags.length, t.id).toBeGreaterThan(2);
  });
});
