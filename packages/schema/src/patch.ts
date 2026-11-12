import { PatchSchema, type Node, type Patch, type PatchOp, type Project } from "./types";
import { validateProject, type ValidationIssue } from "./validate";

export type ApplyResult =
  | { ok: true; project: Project }
  | { ok: false; errors: string[] };

export type ApplyOptions = {
  /** Element-prompt scope guard: ops may only touch this node and its subtree. */
  scope?: string;
};

type Loc = { siblings: Node[]; index: number; parent: Node | null; pageNodes: boolean };

function* walk(nodes: Node[]): Generator<Node> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walk(n.children);
  }
}

function locate(project: Project, id: string): Loc | null {
  const search = (nodes: Node[], parent: Node | null, pageNodes: boolean): Loc | null => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.id === id) return { siblings: nodes, index: i, parent, pageNodes };
      if (n.children) {
        const r = search(n.children, n, false);
        if (r) return r;
      }
    }
    return null;
  };
  for (const page of project.pages) {
    const r = search(page.nodes, null, true);
    if (r) return r;
  }
  return null;
}

/** Child array of a parent id (page id => page.nodes; node id => node.children). */
function childrenOf(project: Project, parentId: string): Node[] | null {
  const page = project.pages.find((p) => p.id === parentId);
  if (page) return page.nodes;
  for (const p of project.pages)
    for (const n of walk(p.nodes)) if (n.id === parentId) return (n.children ??= []);
  return null;
}

/** Merge `patch` into `base`; a null leaf deletes the key. Empty objects are pruned. */
export function mergeStyles(base: Record<string, any> | undefined, patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (isPlainObject(v) && isPlainObject(out[k]) && depthMergeable(k)) out[k] = mergeStyles(out[k], v);
    else out[k] = v;
    if (isPlainObject(out[k]) && Object.keys(out[k]).length === 0) delete out[k];
  }
  return out;
}
// breakpoint/state containers and side/corner objects merge deeply; leaf values like
// gradient or background objects are replaced wholesale.
const DEEP_KEYS = new Set(["base", "tablet", "mobile", "normal", "hover", "padding", "margin", "radius"]);
const depthMergeable = (k: string) => DEEP_KEYS.has(k);
const isPlainObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

function subtreeIds(n: Node): Set<string> {
  return new Set([...walk([n])].map((x) => x.id));
}

export function applyPatch(project: Project, patchInput: unknown, opts: ApplyOptions = {}): ApplyResult {
  const parsed = PatchSchema.safeParse(patchInput);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `patch: ${i.path.join(".")} ${i.message}`) };
  const patch: Patch = parsed.data;

  const next: Project = structuredClone(project);
  let allowed: Set<string> | null = null;
  if (opts.scope) {
    const loc = locate(next, opts.scope);
    if (!loc) return { ok: false, errors: [`scope node "${opts.scope}" not found`] };
    allowed = subtreeIds(loc.siblings[loc.index]!);
  }
  const inScope = (id: string) => !allowed || allowed.has(id);

  for (const [i, op] of patch.ops.entries()) {
    const err = applyOp(next, op, allowed, inScope, opts.scope);
    if (err) return { ok: false, errors: [`op ${i} (${op.op}): ${err}`] };
  }

  normalizePlacement(next);
  const v = validateProject(next);
  if (!v.ok) return { ok: false, errors: v.issues.map(fmt) };
  return { ok: true, project: v.project };
}

const DEFAULT_PLACE = { x: 10, y: 10, w: 40 };

/**
 * Keeps placements consistent however a patch got there: a layer that left its group loses its placement, and a layer that joined one
 * gets a visible starting position (staggered, so several new layers don't hide each other).
 */
function normalizePlacement(p: Project): void {
  const visit = (nodes: Node[], parent: Node | null) => {
    nodes.forEach((n, i) => {
      if (parent?.type === "layerGroup") {
        if (!n.place) n.place = { x: Math.min(60, 10 + i * 6), y: Math.min(60, 10 + i * 6), w: 40 };
      } else if (n.place) delete n.place;
      if (n.children) visit(n.children, n);
    });
  };
  for (const page of p.pages) visit(page.nodes, null);
}

const fmt = (i: ValidationIssue) => `${i.path}: ${i.message}`;

function applyOp(
  p: Project,
  op: PatchOp,
  allowed: Set<string> | null,
  inScope: (id: string) => boolean,
  scopeId?: string,
): string | null {
  switch (op.op) {
    case "update": {
      if (!inScope(op.id)) return `"${op.id}" is outside scope`;
      const loc = locate(p, op.id);
      if (!loc) return `node "${op.id}" not found`;
      const node = loc.siblings[loc.index]!;
      if (op.props) {
        // Shallow merge; a null value removes the key (so optional props can be cleared).
        const merged: Record<string, unknown> = { ...node.props, ...op.props };
        for (const [k, v] of Object.entries(op.props)) if (v === null) delete merged[k];
        node.props = merged;
      }
      if (op.variant !== undefined) node.variant = op.variant;
      if (op.styles === null) delete node.styles;
      else if (op.styles) {
        const merged = mergeStyles(node.styles as any, op.styles);
        if (Object.keys(merged).length) node.styles = merged as any;
        else delete node.styles;
      }
      if (op.place === null) delete node.place;
      else if (op.place) node.place = { ...(node.place ?? DEFAULT_PLACE), ...op.place } as Node["place"];
      if (op.animation === null) delete node.animation;
      else if (op.animation) node.animation = op.animation;
      return null;
    }
    case "insert": {
      if (!inScope(op.parentId)) return `parent "${op.parentId}" is outside scope`;
      const kids = childrenOf(p, op.parentId);
      if (!kids) return `parent "${op.parentId}" not found`;
      if (op.index > kids.length) return `index ${op.index} out of range (0..${kids.length})`;
      kids.splice(op.index, 0, op.node);
      allowed?.add(op.node.id);
      for (const n of walk(op.node.children ?? [])) allowed?.add(n.id);
      return null;
    }
    case "addPage": {
      if (allowed) return "page changes are outside element scope";
      const i = op.index ?? p.pages.length;
      if (i > p.pages.length) return `index ${i} out of range`;
      p.pages.splice(i, 0, op.page);
      return null;
    }
    case "removePage": {
      if (allowed) return "page changes are outside element scope";
      if (p.pages.length <= 1) return "cannot remove the last page";
      const i = p.pages.findIndex((x) => x.id === op.id);
      if (i < 0) return `page "${op.id}" not found`;
      p.pages.splice(i, 1);
      return null;
    }
    case "updatePage": {
      if (allowed) return "page changes are outside element scope";
      const page = p.pages.find((x) => x.id === op.id);
      if (!page) return `page "${op.id}" not found`;
      if (op.name !== undefined) page.name = op.name;
      if (op.path !== undefined) page.path = op.path;
      if (op.seo) page.seo = { ...page.seo, ...op.seo };
      return null;
    }
    case "setPlatform": {
      if (allowed) return "project changes are outside element scope";
      p.platform = op.platform;
      return null;
    }
    case "setApp": {
      if (allowed) return "project changes are outside element scope";
      const merged: Record<string, unknown> = { ...(p.app ?? {}), ...op.app };
      for (const [k, v] of Object.entries(op.app)) if (v === null) delete merged[k];
      if (Object.keys(merged).length) p.app = merged as Project["app"];
      else delete p.app;
      return null;
    }
    case "setBrand": {
      if (allowed) return "brand changes are outside element scope";
      const merged: Record<string, unknown> = { ...(p.brand ?? {}), ...op.brand };
      for (const [k, v] of Object.entries(op.brand)) if (v === null) delete merged[k];
      if (Object.keys(merged).length) p.brand = merged as Project["brand"];
      else delete p.brand;
      return null;
    }
    case "setTheme": {
      if (allowed) return "theme changes are outside element scope";
      const t = op.theme;
      p.theme = {
        ...p.theme,
        ...(t.radius ? { radius: t.radius } : {}),
        ...(t.motion ? { motion: t.motion } : {}),
        colors: { ...p.theme.colors, ...(t.colors as object) },
        fonts: { ...p.theme.fonts, ...(t.fonts as object) },
      } as Project["theme"];
      return null;
    }
    case "remove": {
      if (!inScope(op.id)) return `"${op.id}" is outside scope`;
      if (op.id === scopeId) return "cannot remove the scope root";
      const loc = locate(p, op.id);
      if (!loc) return `node "${op.id}" not found`;
      loc.siblings.splice(loc.index, 1);
      return null;
    }
    case "move": {
      if (!inScope(op.id) || !inScope(op.parentId)) return "move is outside scope";
      if (op.id === scopeId) return "cannot move the scope root";
      const loc = locate(p, op.id);
      if (!loc) return `node "${op.id}" not found`;
      const node = loc.siblings[loc.index]!;
      if (op.parentId === op.id || subtreeIds(node).has(op.parentId)) return "cannot move a node into itself or its descendant";
      loc.siblings.splice(loc.index, 1);
      const kids = childrenOf(p, op.parentId);
      if (!kids) return `parent "${op.parentId}" not found`;
      if (op.index > kids.length) return `index ${op.index} out of range (0..${kids.length})`;
      kids.splice(op.index, 0, node);
      return null;
    }
  }
}

/** Clone a node tree with fresh ids (templates, duplicate). */
export function withFreshIds(node: Node, gen: () => string): Node {
  return { ...structuredClone(node), id: gen(), children: node.children?.map((c) => withFreshIds(c, gen)) };
}
