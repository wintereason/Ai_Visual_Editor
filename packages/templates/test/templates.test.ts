import { describe, expect, it } from "vitest";
import { lintProject, validateProject, type Node, type Project } from "@avc/schema";
import { renderSite } from "@avc/renderer";
import { blankProject, cloneProject, TEMPLATES } from "../src";

const ids = (p: Project) => {
  const out: string[] = [p.id];
  const walk = (n: Node) => { out.push(n.id); n.children?.forEach(walk); };
  p.pages.forEach((pg) => { out.push(pg.id); pg.nodes.forEach(walk); });
  return out;
};

describe.each(TEMPLATES)("template $id", (t) => {
  const project = t.make();
  it("passes full registry validation", () => {
    const r = validateProject(project);
    expect(r.ok ? [] : r.issues).toEqual([]);
  });
  it("has no lint errors and every page has SEO title and description", () => {
    expect(lintProject(project).filter((i) => i.severity === "error")).toEqual([]);
    expect(project.pages.every((p) => p.seo?.title && p.seo?.description)).toBe(true);
  });
  it("every internal link resolves to a page", () => {
    expect(lintProject(project).filter((i) => i.message.includes("doesn't exist"))).toEqual([]);
  });
  it("renders every page", () => {
    const site = renderSite(project);
    expect(Object.keys(site).length).toBe(project.pages.length);
  });
  it("cloneProject gives all-new unique ids and stays valid", () => {
    let n = 0;
    const clone = cloneProject(project, () => `x_${++n}`);
    const a = new Set(ids(project));
    expect(ids(clone).some((i) => a.has(i))).toBe(false);
    expect(new Set(ids(clone)).size).toBe(ids(clone).length);
    expect(validateProject(clone).ok).toBe(true);
  });
  it("make() returns an independent copy each time", () => {
    const a = t.make();
    a.pages[0]!.name = "mutated";
    expect(t.make().pages[0]!.name).not.toBe("mutated");
  });
});

it("blank project is valid", () => {
  expect(validateProject(blankProject()).ok).toBe(true);
});

import { failingPairs } from "@avc/schema";
describe.each(TEMPLATES)("template $id accessibility", (t) => {
  it("theme colors pass WCAG AA contrast", () => {
    expect(failingPairs(t.make().theme.colors)).toEqual([]);
  });
});
