import { collectNodeAssetIds } from "./assets";
import type { Node, Project } from "./types";

export type LintIssue = { severity: "error" | "warning"; message: string; nodeId?: string; pageId?: string };

/** Every string anywhere inside a props object. */
function* strings(v: unknown, depth = 0): Generator<string> {
  if (depth > 8) return;
  if (typeof v === "string") yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x, depth + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v)) yield* strings(x, depth + 1);
}

/** Template text the author must fill in is written as [[a blank like this]]. */
export const BLANK = /\[\[[^\]]{1,200}\]\]/;

function* walk(nodes: Node[]): Generator<Node> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walk(n.children);
  }
}

/** Pre-publish checks (spec W24). Pure; the UI decides how to present them. */
export function lintProject(project: Project, opts: { assetIds?: ReadonlySet<string> } = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const paths = new Set(project.pages.map((p) => p.path));

  if (!project.pages.some((p) => p.path === "/")) issues.push({ severity: "error", message: 'No home page: one page must have the path "/"' });

  for (const page of project.pages) {
    if (!page.seo?.title) issues.push({ severity: "warning", message: `Page "${page.name}" has no SEO title`, pageId: page.id });
    for (const n of walk(page.nodes)) {
      const p = n.props as Record<string, any>;
      if (n.type === "image" && !String(p.alt ?? "").trim())
        issues.push({ severity: "error", message: `Image on "${page.name}" has no alt text`, nodeId: n.id, pageId: page.id });
      if (opts.assetIds && [...collectNodeAssetIds(n)].some((id) => !opts.assetIds!.has(id)))
        issues.push({ severity: "error", message: `${n.type === "video" ? "Video" : "Image"} on "${page.name}" uses a file that is no longer in your media library`, nodeId: n.id, pageId: page.id });
      if (n.type === "gallery" && ((p.images as { alt?: string }[]) ?? []).some((i) => !String(i.alt ?? "").trim()))
        issues.push({ severity: "error", message: `A gallery on "${page.name}" has an image with no alt text`, nodeId: n.id, pageId: page.id });
      if (n.type === "image" && !p.src && !p.assetId)
        issues.push({ severity: "error", message: `Image on "${page.name}" has no source`, nodeId: n.id, pageId: page.id });

      const hrefs: string[] = [p.href, p.ctaHref, p.backHref, p.actionHref, ...((p.links as any[]) ?? []).map((l) => l?.href), ...((p.items as any[]) ?? []).map((l) => l?.href)].filter((h) => typeof h === "string");
      for (const h of hrefs) {
        // Internal links must point at a real page; anchors and external links are not checked.
        if (h.startsWith("/") && !paths.has(h.split(/[?#]/)[0]!))
          issues.push({ severity: "warning", message: `Link "${h}" on "${page.name}" points to a page that doesn't exist`, nodeId: n.id, pageId: page.id });
      }
      // Starter text must be reviewed by a person before it goes live: a notice node to delete, and [[blanks]] to fill in.
      if (n.id.startsWith("legal_notice"))
        issues.push({ severity: "error", message: `"${page.name}" still has the starter-text notice. Check the text is right for your business (ideally have a lawyer read it), then delete the notice.`, nodeId: n.id, pageId: page.id });
      else if ([...strings(n.props)].some((t) => BLANK.test(t)))
        issues.push({ severity: "error", message: `"${page.name}" still has blanks to fill in, shown like [[this]].`, nodeId: n.id, pageId: page.id });
      if (n.type === "button" && !String(p.label ?? "").trim())
        issues.push({ severity: "warning", message: `Button on "${page.name}" has no label`, nodeId: n.id, pageId: page.id });
    }
  }
  // An app with several screens needs a way to move between them.
  if (project.platform !== "web" && project.pages.length > 1 && !project.pages.some((pg) => [...walk(pg.nodes)].some((n) => n.type === "tabBar")))
    issues.push({ severity: "warning", message: "This is an app with several screens but no tab bar, so people have no easy way to move between them. Add one from Elements > App screens." });
  return issues;
}
