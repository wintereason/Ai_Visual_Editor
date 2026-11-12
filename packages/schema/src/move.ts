import { canContain, getDef } from "./registry";
import type { Node, Project } from "./types";

/**
 * Keyboard-friendly moves for the editor: reorder among siblings, nest into the item above, or move out to the parent's level.
 * Pure: it only decides WHERE the item would go (or why it can't); the editor applies the result as an ordinary `move` patch,
 * so every rule (what may contain what, sections only at the top) is still enforced by the same validator as a mouse drag.
 */
export type MoveDir = "up" | "down" | "indent" | "outdent";
export type MovePlan =
  | { ok: true; parentId: string; index: number; summary: string; announce: string }
  | { ok: false; reason: string };

type Loc = { siblings: Node[]; parent: Node | null; index: number };

function find(nodes: Node[], id: string, parent: Node | null = null): Loc | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.id === id) return { siblings: nodes, parent, index: i };
    const inner = n.children ? find(n.children, id, n) : null;
    if (inner) return inner;
  }
  return null;
}

const name = (n: Node) => n.type;

export function planKeyboardMove(project: Project, pageId: string, id: string, dir: MoveDir): MovePlan {
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return { ok: false, reason: "That page no longer exists." };
  const loc = find(page.nodes, id);
  if (!loc) return { ok: false, reason: "Nothing is selected." };
  const node = loc.siblings[loc.index]!;
  const parentId = loc.parent?.id ?? pageId;
  const count = loc.siblings.length;
  const where = loc.parent ? `in ${name(loc.parent)}` : "on the page";

  if (dir === "up" || dir === "down") {
    const to = loc.index + (dir === "up" ? -1 : 1);
    if (to < 0) return { ok: false, reason: `${name(node)} is already first ${where}.` };
    if (to >= count) return { ok: false, reason: `${name(node)} is already last ${where}.` };
    return { ok: true, parentId, index: to, summary: dir === "up" ? "Move up" : "Move down", announce: `Moved ${name(node)} ${dir === "up" ? "up" : "down"}. Position ${to + 1} of ${count} ${where}.` };
  }

  if (dir === "indent") {
    const above = loc.siblings[loc.index - 1];
    if (!above) return { ok: false, reason: `There is nothing above ${name(node)} to move it into.` };
    if (!canContain(above.type, node.type)) return { ok: false, reason: `${name(above)} can't contain ${name(node)}.` };
    const index = above.children?.length ?? 0;
    return { ok: true, parentId: above.id, index, summary: "Nest", announce: `Moved ${name(node)} into ${name(above)}. Position ${index + 1} of ${index + 1}.` };
  }

  // outdent: become a sibling placed right after the current parent
  if (!loc.parent) return { ok: false, reason: `${name(node)} is already at the top level of the page.` };
  const parentLoc = find(page.nodes, loc.parent.id)!;
  const targetParent = parentLoc.parent;
  if (!targetParent) {
    // the target is the page itself: only sections may live there
    if (!getDef(node.type)?.topLevelOnly) return { ok: false, reason: `${name(node)} must stay inside a section; only sections can be at the top level.` };
  } else if (!canContain(targetParent.type, node.type)) {
    return { ok: false, reason: `${name(targetParent)} can't contain ${name(node)}.` };
  }
  const index = parentLoc.index + 1;
  const targetId = targetParent?.id ?? pageId;
  const targetName = targetParent ? `in ${name(targetParent)}` : "on the page";
  return { ok: true, parentId: targetId, index, summary: "Move out", announce: `Moved ${name(node)} out of ${name(loc.parent)}, ${targetName}. Position ${index + 1}.` };
}
