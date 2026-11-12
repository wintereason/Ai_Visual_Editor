import { describe, expect, it } from "vitest";
import { moveDraftSection, removeDraftPage, removeDraftSection, renameDraftPage, validateProject, type Project } from "../src";
import { exampleProject } from "../src";

const sec = (id: string) => ({ id, kind: "container" as const, type: "section", props: {}, children: [] });
const base: Project = {
  ...exampleProject,
  pages: [
    { id: "home", name: "Home", path: "/", nodes: [sec("a"), sec("b"), sec("c")] },
    { id: "about", name: "About", path: "/about", nodes: [sec("d")] },
  ],
};
const ids = (p: Project, pg: string) => p.pages.find((x) => x.id === pg)!.nodes.map((n) => n.id).join("");

describe("draft layout edits", () => {
  it("renames a page, trimming and stripping control characters; refuses blanks and unknown pages", () => {
    expect(renameDraftPage(base, "about", "  Our story\u0007 ").pages[1]!.name).toBe("Our story");
    expect(renameDraftPage(base, "about", "   ")).toBe(base);
    expect(renameDraftPage(base, "nope", "X")).toBe(base);
    expect(renameDraftPage(base, "about", "x".repeat(200)).pages[1]!.name).toHaveLength(60);
    expect(renameDraftPage(base, "about", "New").pages[1]!.path).toBe("/about"); // links keep working
  });
  it("never removes the home page or the last page", () => {
    expect(removeDraftPage(base, "home")).toBe(base);
    expect(removeDraftPage(base, "about").pages.map((p) => p.id)).toEqual(["home"]);
    expect(removeDraftPage({ ...base, pages: [base.pages[1]!] }, "about").pages).toHaveLength(1);
  });
  it("moves sections, and does nothing at the ends", () => {
    expect(ids(moveDraftSection(base, "home", "b", -1), "home")).toBe("bac");
    expect(ids(moveDraftSection(base, "home", "b", 1), "home")).toBe("acb");
    expect(moveDraftSection(base, "home", "a", -1)).toBe(base);
    expect(moveDraftSection(base, "home", "c", 1)).toBe(base);
    expect(moveDraftSection(base, "home", "zzz", 1)).toBe(base);
  });
  it("removes a section but keeps at least one per page", () => {
    expect(ids(removeDraftSection(base, "home", "b"), "home")).toBe("ac");
    expect(removeDraftSection(base, "about", "d")).toBe(base);
  });
  it("does not mutate its input and stays a valid project", () => {
    const snap = JSON.stringify(base);
    const out = moveDraftSection(removeDraftSection(renameDraftPage(base, "home", "Start"), "home", "c"), "home", "b", -1);
    expect(JSON.stringify(base)).toBe(snap);
    expect(validateProject(out).ok).toBe(true);
  });
});

import { addDraftPage, addDraftSection, slugPath } from "../src";
describe("adding to a draft", () => {
  const withFooter = (id: string) => ({ id, kind: "container" as const, type: "section", props: {}, children: [{ id: id + "f", kind: "block" as const, type: "footer", variant: "simple", props: { copyright: "c", links: [] } }] });
  it("slugs names into valid paths", () => {
    expect(slugPath("Our Story!")).toBe("/our-story");
    expect(slugPath("  ")).toBe("/page");
    expect(slugPath("कोर्स")).toBe("/page");
    expect(slugPath("a".repeat(100))).toHaveLength(41);
  });
  it("adds a page with a unique path and a valid result", () => {
    const one = addDraftPage(base, "About", "p3", [sec("x")]);
    expect(one.pages.map((p) => p.path)).toEqual(["/", "/about", "/about-2"]);
    expect(validateProject(one).ok).toBe(true);
    expect(addDraftPage(base, "  ", "p4", [sec("y")])).toBe(base);
    expect(addDraftPage(base, "Empty", "p4", [])).toBe(base);
    expect(addDraftPage(base, "Dup", "home", [sec("y")])).toBe(base);
  });
  it("caps pages at 8", () => {
    let p = base;
    for (let i = 0; i < 10; i++) p = addDraftPage(p, `Page ${i}`, `n${i}`, [sec(`s${i}`)]);
    expect(p.pages).toHaveLength(8);
  });
  it("adds a section before a trailing footer, otherwise at the end; refuses duplicates and non-sections", () => {
    const p = { ...base, pages: [{ ...base.pages[0]!, nodes: [sec("a"), withFooter("z")] }, base.pages[1]!] };
    expect(ids(addDraftSection(p, "home", sec("m")), "home")).toBe("amz");
    expect(ids(addDraftSection(base, "home", sec("m")), "home")).toBe("abcm");
    expect(addDraftSection(base, "home", sec("a"))).toBe(base);
    expect(addDraftSection(base, "home", { ...sec("q"), type: "container" })).toBe(base);
    expect(addDraftSection(base, "nope", sec("q"))).toBe(base);
  });
  it("caps sections at 12 per page", () => {
    let p = base;
    for (let i = 0; i < 20; i++) p = addDraftSection(p, "home", sec(`k${i}`));
    expect(p.pages[0]!.nodes).toHaveLength(12);
  });
});
