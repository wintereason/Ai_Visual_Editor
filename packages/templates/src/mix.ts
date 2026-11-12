import { validateProject, lintProject, type Node, type Page, type Project } from "@avc/schema";
import { cloneProject } from "./build";
import { TEMPLATES } from "./index";

export type PageRef = { templateId: string; pageId: string };
export type MixResult = { ok: true; project: Project } | { ok: false; error: string };

const FOOTER_MARK = /^©\s/;

function walk(nodes: Node[], fn: (n: Node) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.children) walk(n.children, fn);
  }
}

/**
 * Build one coherent site from pages chosen across several templates (spec W04).
 * Pages from different templates are unified so the result looks like one site, not a collage:
 *  - one theme and one name (from `themeFrom`), including the brand in navbars, footers and page titles
 *  - navigation and footer links rebuilt from the pages actually chosen
 *  - internal links that would point at a page that is not in the mix are redirected to one that is
 * Everything is cloned with fresh ids; templates themselves are never modified.
 */
export function mixTemplates(refs: PageRef[], themeFromId: string, gen: () => string): MixResult {
  if (refs.length === 0) return { ok: false, error: "Choose at least one page." };
  const themeSource = TEMPLATES.find((t) => t.id === themeFromId);
  if (!themeSource) return { ok: false, error: "Choose which template the colors and fonts come from." };
  const themeProject = themeSource.make();

  const picked: { page: Page; brand: string }[] = [];
  for (const ref of refs) {
    const t = TEMPLATES.find((x) => x.id === ref.templateId);
    const proj = t?.make();
    const page = proj?.pages.find((p) => p.id === ref.pageId);
    if (!t || !proj || !page) return { ok: false, error: "One of the chosen pages no longer exists." };
    picked.push({ page, brand: proj.name });
  }

  const seen = new Map<string, string>();
  for (const { page } of picked) {
    if (seen.has(page.path)) return { ok: false, error: `Two pages would both live at "${page.path}" (${seen.get(page.path)} and ${page.name}). Pick only one of them.` };
    seen.set(page.path, page.name);
  }
  if (!seen.has("/")) return { ok: false, error: "A site needs a home page. Include one page with the path \"/\" (usually \"Home\")." };

  const brand = themeProject.name;
  const ordered = [...picked].sort((a, b) => (a.page.path === "/" ? -1 : b.page.path === "/" ? 1 : 0)); // home first, the rest in chosen order
  const paths = new Set(ordered.map((p) => p.page.path));
  const nav = ordered.map((p) => ({ label: p.page.name, href: p.page.path }));
  const fallback = paths.has("/contact") ? "/contact" : (ordered.find((p) => p.page.path !== "/")?.page.path ?? "/");

  const fix = (href: unknown) => {
    if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return href;
    const path = href.split(/[?#]/)[0]!;
    return paths.has(path) ? href : fallback;
  };

  const draft: Project = {
    ...structuredClone(themeProject),
    pages: ordered.map(({ page, brand: oldBrand }) => {
      const p = structuredClone(page);
      if (p.seo?.title?.endsWith(` | ${oldBrand}`)) p.seo.title = `${p.seo.title.slice(0, -oldBrand.length)}${brand}`;
      walk(p.nodes, (n) => {
        const props = n.props as Record<string, any>;
        if (n.type === "navbar") {
          props.brand = brand;
          props.links = nav;
        } else if (n.type === "footer") {
          props.links = nav;
          if (typeof props.copyright === "string" && FOOTER_MARK.test(props.copyright)) props.copyright = `© ${brand}. All rights reserved.`;
        }
        if ("href" in props) props.href = fix(props.href);
        if ("ctaHref" in props) props.ctaHref = fix(props.ctaHref);
        if (Array.isArray(props.plans)) for (const pl of props.plans) if (pl && "ctaHref" in pl) pl.ctaHref = fix(pl.ctaHref);
      });
      return p;
    }),
  };
  draft.id = "tpl_mix";

  const cloned = cloneProject(draft, gen);
  const v = validateProject(cloned);
  if (!v.ok) return { ok: false, error: `The mix is invalid: ${v.issues[0]?.message ?? "unknown problem"}` };
  const errors = lintProject(v.project).filter((i) => i.severity === "error");
  if (errors.length) return { ok: false, error: errors[0]!.message };
  return { ok: true, project: v.project };
}
