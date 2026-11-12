import { canContain, type Project } from "@avc/schema";
import { findNode } from "./store";

export type DropTarget = {
  parentId: string;
  index: number;
  /** Non-section dropped at page level: caller must wrap it in a new section. */
  wrapInSection: boolean;
  line: { left: number; top: number; width: number; height: number };
};

const dataChildren = (el: Element, exclude?: string) =>
  Array.from(el.children).filter((c) => c.hasAttribute("data-node") && c.getAttribute("data-node") !== exclude) as HTMLElement[];

/**
 * Spec 8.2: find deepest container under the pointer that accepts the dragged type,
 * walk up otherwise, then compute the index from sibling midpoints.
 * (x, y) are in the iframe document's viewport coordinates.
 */
export function resolveDrop(
  doc: Document,
  x: number,
  y: number,
  project: Project,
  pageId: string,
  draggedType: string,
  movingId?: string,
): DropTarget | null {
  const root = doc.querySelector("main") as HTMLElement | null;
  if (!root) return null;

  const movingEl = movingId ? doc.querySelector(`[data-node="${movingId}"]`) : null;
  let targetEl: HTMLElement | null = null;
  let targetId = pageId;

  for (const el of doc.elementsFromPoint(x, y)) {
    if (!el.hasAttribute("data-node")) continue; // no instanceof: iframe elements have a different realm
    if (movingEl && movingEl.contains(el)) continue; // never into own subtree
    const id = el.getAttribute("data-node")!;
    const found = findNode(project, id);
    if (found && canContain(found.node.type, draggedType)) {
      targetEl = el as HTMLElement;
      targetId = id;
      break;
    }
  }

  const container: HTMLElement = (targetEl as HTMLElement | null) ?? root;
  const wrapInSection = !targetEl && draggedType !== "section";
  const kids = dataChildren(container, movingId);
  const cs = doc.defaultView!.getComputedStyle(container);
  const horizontal = cs.display.includes("flex") && cs.flexDirection.startsWith("row");

  let index = 0;
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
    if ((horizontal ? x : y) > mid) index++;
  }

  const scrollX = doc.defaultView!.scrollX;
  const scrollY = doc.defaultView!.scrollY;
  let line: DropTarget["line"];
  const cr = container.getBoundingClientRect();
  if (kids.length === 0) {
    line = { left: cr.left + scrollX + 8, top: cr.top + scrollY + 8, width: Math.max(cr.width - 16, 24), height: 3 };
  } else {
    const ref = kids[Math.min(index, kids.length - 1)]!.getBoundingClientRect();
    const after = index >= kids.length;
    if (horizontal) {
      line = { left: (after ? ref.right : ref.left) + scrollX - 1, top: ref.top + scrollY, width: 3, height: ref.height };
    } else {
      line = { left: ref.left + scrollX, top: (after ? ref.bottom : ref.top) + scrollY - 1, width: ref.width, height: 3 };
    }
  }

  // Page level: index counts sections only; wrapping appends at the computed position.
  return { parentId: targetId, index, wrapInSection, line };
}
