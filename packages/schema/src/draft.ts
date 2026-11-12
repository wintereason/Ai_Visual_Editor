import type { Node, Project } from "./types";

// Edits a person can make to an AI-designed layout before approving it. Pure functions: each returns a new project, or the
// SAME project object when the edit is not allowed (so a caller can tell "nothing happened" with ===).

export const MAX_DRAFT_NAME = 60;

/** Rename a page. The path is left alone so links keep working; blank or over-long names are refused. */
export function renameDraftPage(project: Project, pageId: string, name: string): Project {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_DRAFT_NAME);
  if (!clean || !project.pages.some((p) => p.id === pageId)) return project;
  return { ...project, pages: project.pages.map((p) => (p.id === pageId ? { ...p, name: clean } : p)) };
}

/** Remove a page. The home page ("/") and the last remaining page cannot be removed. */
export function removeDraftPage(project: Project, pageId: string): Project {
  const page = project.pages.find((p) => p.id === pageId);
  if (!page || page.path === "/" || project.pages.length <= 1) return project;
  return { ...project, pages: project.pages.filter((p) => p.id !== pageId) };
}

/** Move a top-level section up (-1) or down (+1) within its page. Does nothing at the ends. */
export function moveDraftSection(project: Project, pageId: string, sectionId: string, dir: -1 | 1): Project {
  const page = project.pages.find((p) => p.id === pageId);
  const i = page ? page.nodes.findIndex((n) => n.id === sectionId) : -1;
  const j = i + dir;
  if (!page || i < 0 || j < 0 || j >= page.nodes.length) return project;
  const nodes = page.nodes.slice();
  [nodes[i], nodes[j]] = [nodes[j]!, nodes[i]!];
  return { ...project, pages: project.pages.map((p) => (p.id === pageId ? { ...p, nodes } : p)) };
}

/** Remove a top-level section. A page must keep at least one section. */
export function removeDraftSection(project: Project, pageId: string, sectionId: string): Project {
  const page = project.pages.find((p) => p.id === pageId);
  if (!page || page.nodes.length <= 1 || !page.nodes.some((n) => n.id === sectionId)) return project;
  return { ...project, pages: project.pages.map((p) => (p.id === pageId ? { ...p, nodes: p.nodes.filter((n) => n.id !== sectionId) } : p)) };
}

export const MAX_DRAFT_PAGES = 8;
export const MAX_DRAFT_SECTIONS = 12;

/** "Our Story!" -> "/our-story". Falls back to "/page" when nothing usable is left. */
export function slugPath(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return "/" + (s || "page");
}

/** Add a page made of the given sections. Its path comes from its name and is made unique. Refused past the page limit or for a blank name. */
export function addDraftPage(project: Project, name: string, id: string, nodes: Node[]): Project {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_DRAFT_NAME);
  if (!clean || nodes.length === 0 || project.pages.length >= MAX_DRAFT_PAGES || project.pages.some((p) => p.id === id)) return project;
  const taken = new Set(project.pages.map((p) => p.path));
  const base = slugPath(clean) === "/" ? "/page" : slugPath(clean);
  let path = base;
  for (let i = 2; taken.has(path); i++) path = `${base}-${i}`;
  return { ...project, pages: [...project.pages, { id, name: clean, path, nodes }] };
}

/**
 * Add a top-level section to a page. It goes before a trailing footer section if there is one, otherwise at the end.
 * Refused past the per-page section limit.
 */
export function addDraftSection(project: Project, pageId: string, section: Node): Project {
  const page = project.pages.find((p) => p.id === pageId);
  if (!page || page.nodes.length >= MAX_DRAFT_SECTIONS || section.type !== "section" || page.nodes.some((n) => n.id === section.id)) return project;
  const last = page.nodes[page.nodes.length - 1];
  const endsWithFooter = !!last && (last.children ?? []).some((c) => c.type === "footer");
  const at = endsWithFooter ? page.nodes.length - 1 : page.nodes.length;
  const nodes = [...page.nodes.slice(0, at), section, ...page.nodes.slice(at)];
  return { ...project, pages: project.pages.map((p) => (p.id === pageId ? { ...p, nodes } : p)) };
}
