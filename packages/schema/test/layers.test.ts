import { describe, expect, it } from "vitest";
import { applyPatch, exampleProject, validateProject, type Node, type Project } from "../src";

const group = (children: Node[] = []): Node => ({ id: "lg", kind: "layerGroup", type: "layerGroup", props: { aspect: "16 / 9" }, children });
const layer = (id: string, extra: Partial<Node> = {}): Node => ({ id, kind: "element", type: "text", props: { text: id }, ...extra });
const withGroup = (g: Node = group()): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[1]!.children!.push(g);
  return p;
};
const ok = (p: Project, ops: object[]) => {
  const r = applyPatch(p, { summary: "t", ops });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.project;
};
const find = (p: Project, id: string): Node => {
  const walk = (ns: Node[]): Node | undefined => { for (const n of ns) { if (n.id === id) return n; const c = n.children && walk(n.children); if (c) return c; } };
  return walk(p.pages.flatMap((pg) => pg.nodes))!;
};

describe("layerGroup", () => {
  it("is valid, with children that carry a placement", () => {
    const p = withGroup(group([layer("a", { place: { x: 5, y: 5, w: 30 } })]));
    expect(validateProject(p).ok).toBe(true);
  });

  it("only accepts the aspect ratios it knows", () => {
    const g = group();
    (g.props as Record<string, unknown>).aspect = "7 / 3";
    expect(validateProject(withGroup(g)).ok).toBe(false);
  });

  it("a placement outside a group is an error in a loaded file", () => {
    const p = withGroup();
    p.pages[0]!.nodes[0]!.children![0]!.place = { x: 1, y: 1, w: 10 };
    expect(validateProject(p).ok).toBe(false);
  });

  it("refuses placements that are out of range or have extra keys", () => {
    for (const place of [{ x: 0, y: 0, w: 0 }, { x: 0, y: 0, w: 500 }, { x: 999, y: 0, w: 10 }, { x: 0, y: 0, w: 10, r: 400 }, { x: 0, y: 0, w: 10, z: 3 }]) {
      expect(validateProject(withGroup(group([layer("a", { place: place as never })]))).ok, JSON.stringify(place)).toBe(false);
    }
  });

  it("a layer added without a placement gets a visible one, and several don't pile up", () => {
    let p = withGroup();
    p = ok(p, [{ op: "insert", parentId: "lg", index: 0, node: layer("a") }, { op: "insert", parentId: "lg", index: 1, node: layer("b") }]);
    const a = find(p, "a").place!, b = find(p, "b").place!;
    expect(a.w).toBeGreaterThan(0);
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it("update merges a placement; null removes it (and a new one is made)", () => {
    let p = withGroup(group([layer("a", { place: { x: 10, y: 10, w: 40 } })]));
    p = ok(p, [{ op: "update", id: "a", place: { x: 50 } }]);
    expect(find(p, "a").place).toEqual({ x: 50, y: 10, w: 40 });
    p = ok(p, [{ op: "update", id: "a", place: { r: 15 } }]);
    expect(find(p, "a").place).toEqual({ x: 50, y: 10, w: 40, r: 15 });
    p = ok(p, [{ op: "update", id: "a", place: null }]);
    expect(find(p, "a").place).toBeDefined(); // a layer always has somewhere to be
  });

  it("moving a layer out of its group drops the placement; moving one in gives it one", () => {
    let p = withGroup(group([layer("a", { place: { x: 20, y: 20, w: 30 } })]));
    const sectionId = p.pages[0]!.nodes[1]!.id;
    p = ok(p, [{ op: "move", id: "a", parentId: sectionId, index: 0 }]);
    expect(find(p, "a").place).toBeUndefined();
    expect(validateProject(p).ok).toBe(true);
    p = ok(p, [{ op: "move", id: "a", parentId: "lg", index: 0 }]);
    expect(find(p, "a").place).toBeDefined();
    expect(validateProject(p).ok).toBe(true);
  });

  it("reordering layers changes the stacking order and keeps each position", () => {
    let p = withGroup(group([layer("a", { place: { x: 1, y: 2, w: 30 } }), layer("b", { place: { x: 3, y: 4, w: 30 } })]));
    p = ok(p, [{ op: "move", id: "a", parentId: "lg", index: 1 }]);
    expect(find(p, "lg").children!.map((c) => c.id)).toEqual(["b", "a"]);
    expect(find(p, "a").place).toEqual({ x: 1, y: 2, w: 30 });
  });

  it("changing a placement does not touch the original project", () => {
    const p = withGroup(group([layer("a", { place: { x: 10, y: 10, w: 40 } })]));
    ok(p, [{ op: "update", id: "a", place: { x: 90 } }]);
    expect(find(p, "a").place!.x).toBe(10);
  });

  it("an element-scoped (AI) edit of one layer can move that layer only", () => {
    const p = withGroup(group([layer("a", { place: { x: 10, y: 10, w: 40 } }), layer("b", { place: { x: 50, y: 50, w: 40 } })]));
    const good = applyPatch(p, { summary: "t", ops: [{ op: "update", id: "a", place: { x: 20 } }] }, { scope: "a" });
    expect(good.ok).toBe(true);
    const bad = applyPatch(p, { summary: "t", ops: [{ op: "update", id: "b", place: { x: 20 } }] }, { scope: "a" });
    expect(bad.ok).toBe(false);
  });
});
