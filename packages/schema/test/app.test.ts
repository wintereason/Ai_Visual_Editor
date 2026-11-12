import { describe, expect, it } from "vitest";
import { applyPatch, collectAssetIds, collectKeptAssetIds, exampleProject, lintProject, validateProject, type Node, type Project } from "../src";

const base = (): Project => structuredClone(exampleProject);
const op = (p: Project, o: object, opts: Record<string, unknown> = {}) => applyPatch(p, { summary: "t", ops: [o as never] }, opts as never);
const withBlock = (n: Node): Project => { const p = base(); p.pages[0]!.nodes[1]!.children!.push(n); return p; };
const block = (type: string, props: Record<string, unknown>, variant?: string): Node => ({ id: `b_${type}`, kind: "block", type, props, ...(variant ? { variant } : {}) });
const tabs = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Tab ${i}`, href: i === 0 ? "/" : `#t${i}`, icon: "home" }));

describe("platform", () => {
  it("can be switched between web, mobile and web+mobile", () => {
    for (const platform of ["web", "mobile", "web+mobile"]) {
      const r = op(base(), { op: "setPlatform", platform });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.project.platform).toBe(platform);
    }
  });
  it("refuses anything else, and an element-scoped (AI) edit can't change it", () => {
    expect(op(base(), { op: "setPlatform", platform: "desktop" }).ok).toBe(false);
    const id = base().pages[0]!.nodes[0]!.children![0]!.id;
    expect(op(base(), { op: "setPlatform", platform: "mobile" }, { scope: id }).ok).toBe(false);
  });
});

describe("app settings", () => {
  it("sets, merges and clears settings; an empty set is removed", () => {
    let r = op(base(), { op: "setApp", app: { shortName: "Bright", themeColor: "#1D4ED8", display: "standalone" } });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.project.app).toEqual({ shortName: "Bright", themeColor: "#1D4ED8", display: "standalone" });
    r = op(r.project, { op: "setApp", app: { shortName: "B2" } });
    if (!r.ok) throw new Error("merge");
    expect(r.project.app).toEqual({ shortName: "B2", themeColor: "#1D4ED8", display: "standalone" });
    r = op(r.project, { op: "setApp", app: { shortName: null, themeColor: null, display: null } });
    if (!r.ok) throw new Error("clear");
    expect(r.project.app).toBeUndefined();
  });
  it("refuses bad colours, long names, unknown display modes and unknown keys", () => {
    for (const bad of [{ themeColor: "red" }, { themeColor: "#FFF" }, { backgroundColor: "#GGGGGG" }, { shortName: "x".repeat(13) }, { display: "fullscreen" }, { nope: 1 }]) {
      expect(op(base(), { op: "setApp", app: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("old projects without app settings still validate; the icon is kept, but only published when used", () => {
    expect(validateProject(base()).ok).toBe(true);
    const r = op(base(), { op: "setApp", app: { iconAssetId: "asset_icon" } });
    if (!r.ok) throw new Error("icon");
    expect(collectKeptAssetIds(r.project).has("asset_icon")).toBe(true);
  });
  it("is outside the scope of an element-scoped edit", () => {
    const id = base().pages[0]!.nodes[0]!.children![0]!.id;
    expect(op(base(), { op: "setApp", app: { shortName: "x" } }, { scope: id }).ok).toBe(false);
  });
});

describe("app blocks", () => {
  it("appHeader: valid with and without the optional parts, in both variants", () => {
    for (const variant of ["plain", "colored"]) {
      expect(validateProject(withBlock(block("appHeader", { title: "Home" }, variant))).ok).toBe(true);
      expect(validateProject(withBlock(block("appHeader", { title: "Notices", subtitle: "This week", backHref: "/", actionLabel: "Edit", actionHref: "#" }, variant))).ok).toBe(true);
    }
    expect(validateProject(withBlock(block("appHeader", { title: "x" }, "huge"))).ok).toBe(false);
    expect(validateProject(withBlock(block("appHeader", { title: "x".repeat(61) }))).ok).toBe(false);
    expect(validateProject(withBlock(block("appHeader", { title: "x", backHref: "javascript:alert(1)" }))).ok).toBe(false);
  });
  it("tabBar: 2 to 5 tabs, known icons, safe links", () => {
    for (const n of [2, 3, 4, 5]) expect(validateProject(withBlock(block("tabBar", { items: tabs(n) }, "bottom"))).ok, `${n} tabs`).toBe(true);
    expect(validateProject(withBlock(block("tabBar", { items: tabs(1) }))).ok).toBe(false);
    expect(validateProject(withBlock(block("tabBar", { items: tabs(6) }))).ok).toBe(false);
    expect(validateProject(withBlock(block("tabBar", { items: [{ label: "A", href: "/", icon: "nope" }, { label: "B", href: "/" }] }))).ok).toBe(false);
    expect(validateProject(withBlock(block("tabBar", { items: [{ label: "A", href: "javascript:x", icon: "home" }, { label: "B", href: "/", icon: "home" }] }))).ok).toBe(false);
    expect(validateProject(withBlock(block("tabBar", { items: [{ label: "x".repeat(17), href: "/", icon: "home" }, { label: "B", href: "/", icon: "home" }] }))).ok).toBe(false);
  });
  it("tabBar: an icon left out defaults to home", () => {
    expect(validateProject(withBlock(block("tabBar", { items: [{ label: "A", href: "/" }, { label: "B", href: "#b" }] }))).ok).toBe(true);
  });
  it("appList: rows with optional icon, subtitle, link and badge", () => {
    const items = [{ title: "Maths", subtitle: "9 am", icon: "book", href: "#m", badge: "New" }, { title: "Plain row" }];
    for (const variant of ["inset", "plain"]) expect(validateProject(withBlock(block("appList", { title: "Today", items }, variant))).ok).toBe(true);
    expect(validateProject(withBlock(block("appList", { items: [] }))).ok).toBe(false);
    expect(validateProject(withBlock(block("appList", { items: Array.from({ length: 21 }, (_, i) => ({ title: `r${i}` })) }))).ok).toBe(false);
    expect(validateProject(withBlock(block("appList", { items: [{ title: "x", icon: "nope" }] }))).ok).toBe(false);
  });
  it("links in tab bars and lists are checked like any other link", () => {
    const p = withBlock(block("tabBar", { items: [{ label: "A", href: "/", icon: "home" }, { label: "Gone", href: "/does-not-exist", icon: "home" }] }));
    expect(lintProject(p).some((i) => i.message.includes("/does-not-exist"))).toBe(true);
  });
});

describe("icon and shape names are now dropdowns, and still strict", () => {
  it("rejects unknown names", () => {
    expect(validateProject(withBlock({ id: "i", kind: "element", type: "icon", props: { name: "nope" } })).ok).toBe(false);
    expect(validateProject(withBlock({ id: "i", kind: "element", type: "icon", props: { name: "star" } })).ok).toBe(true);
    expect(validateProject(withBlock({ id: "s", kind: "element", type: "shape", props: { shape: "nope" } })).ok).toBe(false);
  });
  void collectAssetIds;
});
