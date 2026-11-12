import type { Node, Project } from "@avc/schema";

/** Where a node lives, found without exposing anything else on the page. */
export function locateNode(project: Project, id: string): { node: Node; parentId: string; parentType: string; pageId: string } | null {
  const visit = (nodes: Node[], parentId: string, parentType: string, pageId: string): ReturnType<typeof locateNode> => {
    for (const n of nodes) {
      if (n.id === id) return { node: n, parentId, parentType, pageId };
      const r = n.children && visit(n.children, n.id, n.type, pageId);
      if (r) return r;
    }
    return null;
  };
  for (const p of project.pages) {
    const r = visit(p.nodes, p.id, "(page)", p.id);
    if (r) return r;
  }
  return null;
}

const MAX_TEXT = 300;
const MAX_JSON = 6000;

const clip = (v: unknown, depth = 0): unknown => {
  if (typeof v === "string") return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 24).map((x) => clip(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, depth + 1)]));
  return v;
};

/** The selected node only (not its siblings, not other sections or pages), clipped so a huge section cannot blow the budget. */
export function nodeForPrompt(node: Node): unknown {
  const full = clip(node) as Node;
  if (JSON.stringify(full).length <= MAX_JSON) return full;
  // Too big: keep the node itself and replace each child by a short summary.
  return { ...full, children: node.children?.map((c) => ({ id: c.id, type: c.type, ...(c.variant ? { variant: c.variant } : {}), children: c.children?.length ?? 0 })) };
}

/** Plain text from the user, made safe to embed as data: control characters removed, our delimiter tags stripped. */
export function cleanText(raw: string, max: number): { ok: true; text: string } | { ok: false; error: string } {
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/<\/?\s*(instruction|node|brief|page|structure)\b[^>]*>/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return { ok: false, error: "Write what you would like to change." };
  if (text.length > max) return { ok: false, error: `That is too long (${text.length} characters). Please keep it under ${max}.` };
  return { ok: true, text };
}
