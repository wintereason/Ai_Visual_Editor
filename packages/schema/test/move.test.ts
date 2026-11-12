import { describe, expect, it } from "vitest";
import { applyPatch, exampleProject, planKeyboardMove, validateProject, type Node, type Project } from "../src";

const el = (id: string, type = "text"): Node => ({ id, kind: "element", type, props: type === "heading" ? { text: id, level: 2 } : { text: id } });
const box = (id: string, children: Node[] = []): Node => ({ id, kind: "container", type: "container", props: {}, children });
const sec = (id: string, children: Node[]): Node => ({ id, kind: "container", type: "section", props: {}, children });
/** page: S1[ a, b, C[ c1, c2 ], d ]   S2[ e ] */
function project(): Project {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes = [sec("S1", [el("a"), el("b"), box("C", [el("c1"), el("c2")]), el("d")]), sec("S2", [el("e")])];
  return p;
}
const pid = (p: Project) => p.pages[0]!.id;
const plan = (p: Project, id: string, dir: "up" | "down" | "indent" | "outdent") => planKeyboardMove(p, pid(p), id, dir);
const apply = (p: Project, id: string, dir: "up" | "down" | "indent" | "outdent") => {
  const m = plan(p, id, dir);
  if (!m.ok) throw new Error(m.reason);
  const r = applyPatch(p, { summary: m.summary, ops: [{ op: "move", id, parentId: m.parentId, index: m.index }] });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.project;
};
const order = (p: Project, id: string) => { const f = (ns: Node[]): string[] | null => { for (const n of ns) { if (n.id === id) return (n.children ?? []).map((c) => c.id); const x = n.children && f(n.children); if (x) return x; } return null; }; return f(p.pages[0]!.nodes)!; };

describe("keyboard move: reorder among siblings", () => {
  it("moves up and down, one place at a time, and the result is a valid project", () => {
    let p = apply(project(), "b", "up");
    expect(order(p, "S1")).toEqual(["b", "a", "C", "d"]);
    p = apply(p, "b", "down");
    expect(order(p, "S1")).toEqual(["a", "b", "C", "d"]);
    expect(validateProject(p).ok).toBe(true);
  });
  it("says why it can't, at either end, instead of doing nothing silently", () => {
    expect(plan(project(), "a", "up")).toEqual({ ok: false, reason: "text is already first in section." });
    expect(plan(project(), "d", "down")).toEqual({ ok: false, reason: "text is already last in section." });
  });
  it("works for whole sections at the top of the page", () => {
    const p = apply(project(), "S2", "up");
    expect(p.pages[0]!.nodes.map((n) => n.id)).toEqual(["S2", "S1"]);
    expect(plan(p, "S2", "up").ok).toBe(false);
  });
  it("announces the new position", () => {
    const m = plan(project(), "b", "down");
    expect(m.ok && m.announce).toBe("Moved text down. Position 3 of 4 in section.");
  });
});

describe("keyboard move: nesting (indent) and un-nesting (outdent)", () => {
  it("indent puts an item at the end of the container just above it", () => {
    const p = apply(project(), "d", "indent");
    expect(order(p, "C")).toEqual(["c1", "c2", "d"]);
    expect(order(p, "S1")).toEqual(["a", "b", "C"]);
    expect(validateProject(p).ok).toBe(true);
  });
  it("indent is refused when there is nothing above, or the item above can't hold it", () => {
    expect(plan(project(), "a", "indent")).toEqual({ ok: false, reason: "There is nothing above text to move it into." });
    expect(plan(project(), "b", "indent")).toEqual({ ok: false, reason: "text can't contain text." }); // text can't hold children
    expect(plan(project(), "S2", "indent").ok).toBe(false); // a section can't go inside another section
  });
  it("outdent moves an item out to sit right after its parent", () => {
    const p = apply(project(), "c1", "outdent");
    expect(order(p, "S1")).toEqual(["a", "b", "C", "c1", "d"]);
    expect(order(p, "C")).toEqual(["c2"]);
    expect(validateProject(p).ok).toBe(true);
  });
  it("indent then outdent returns to where it started", () => {
    const p = apply(apply(project(), "d", "indent"), "d", "outdent");
    expect(order(p, "S1")).toEqual(["a", "b", "C", "d"]);
    expect(order(p, "C")).toEqual(["c1", "c2"]);
  });
  it("an item directly in a section can't leave it (only sections may sit at the top of a page)", () => {
    expect(plan(project(), "a", "outdent")).toEqual({ ok: false, reason: "text must stay inside a section; only sections can be at the top level." });
  });
  it("a section is already at the top", () => {
    expect(plan(project(), "S1", "outdent")).toEqual({ ok: false, reason: "section is already at the top level of the page." });
  });
  it("what the validator would refuse, the plan refuses first (so the keyboard never produces an invalid move)", () => {
    const p = project();
    for (const id of ["a", "b", "C", "c1", "c2", "d", "S1", "S2", "e"]) for (const dir of ["up", "down", "indent", "outdent"] as const) {
      const m = plan(p, id, dir);
      if (!m.ok) continue;
      expect(applyPatch(p, { summary: "x", ops: [{ op: "move", id, parentId: m.parentId, index: m.index }] }).ok, `${id} ${dir}`).toBe(true);
    }
  });
  it("unknown ids and pages are reported, not thrown", () => {
    expect(planKeyboardMove(project(), "nope", "a", "up").ok).toBe(false);
    expect(plan(project(), "nope", "up").ok).toBe(false);
  });
});

describe("keyboard move with photo-layer groups", () => {
  it("moving into a layer group gives the item a visible placement, and moving out removes it", () => {
    const p = project();
    p.pages[0]!.nodes[0]!.children!.splice(2, 0, { id: "G", kind: "layerGroup", type: "layerGroup", props: { aspect: "16 / 9" }, children: [] });
    const into = apply(p, "C", "indent"); // C sits right after G
    const c = into.pages[0]!.nodes[0]!.children!.find((n) => n.id === "G")!.children![0]!;
    expect(c.id).toBe("C");
    expect(c.place).toBeDefined();
    const out = apply(into, "C", "outdent");
    expect(out.pages[0]!.nodes[0]!.children!.find((n) => n.id === "C")!.place).toBeUndefined();
    expect(validateProject(out).ok).toBe(true);
  });
});
