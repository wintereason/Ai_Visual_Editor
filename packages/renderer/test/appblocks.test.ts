import { describe, expect, it } from "vitest";
import { exampleProject, validateProject, type Node, type Page, type Project } from "@avc/schema";
import { renderDocument, renderPage } from "../src";

const block = (id: string, type: string, props: Record<string, unknown>, variant?: string): Node => ({ id, kind: "block", type, props, ...(variant ? { variant } : {}) });
function app(nodes: Node[], platform: Project["platform"] = "mobile", extraPages: Page[] = []): Project {
  const p = structuredClone(exampleProject);
  p.platform = platform;
  p.pages[0]!.nodes = [{ id: "s", kind: "container", type: "section", props: {}, children: nodes }];
  p.pages.push(...extraPages);
  const v = validateProject(p);
  if (!v.ok) throw new Error(v.issues.map((i) => i.message).join());
  return p;
}
const tabs = block("tb", "tabBar", { items: [{ label: "Home", href: "/", icon: "home" }, { label: "Classes", href: "/classes", icon: "book" }, { label: "Me", href: "/me#top", icon: "user" }] }, "bottom");
const page = (id: string, path: string): Page => ({ id, name: id, path, seo: { title: id }, nodes: [{ id: id + "s", kind: "container", type: "section", props: {}, children: [{ ...tabs, id: id + "_tabs" }] }] });

describe("appHeader", () => {
  it("shows the title, an optional subtitle, back link and action", () => {
    const html = renderPage(app([block("h", "appHeader", { title: "Notices", subtitle: "This week", backHref: "/", actionLabel: "Edit", actionHref: "#e" }, "colored")]), "page_home").html;
    expect(html).toContain('class="avc-ah avc-ah-colored n-h"');
    expect(html).toContain("<h1>Notices</h1>");
    expect(html).toContain("<p>This week</p>");
    expect(html).toContain('<a class="avc-ah-back" href="/" aria-label="Back">');
    expect(html).toContain('<a class="avc-ah-act" href="#e">Edit</a>');
  });
  it("leaves out what wasn't given", () => {
    const html = renderPage(app([block("h", "appHeader", { title: "Home" })]), "page_home").html;
    expect(html).not.toContain("avc-ah-back");
    expect(html).not.toContain("avc-ah-act");
    expect(html).toContain("avc-ah-plain");
  });
  it("escapes its text", () => {
    expect(renderPage(app([block("h", "appHeader", { title: "<img src=x onerror=alert(1)>" })]), "page_home").html).not.toContain("<img src=x");
  });
});

describe("tabBar", () => {
  it("is a labelled navigation with one link per tab, each with an icon", () => {
    const html = renderPage(app([tabs]), "page_home").html;
    expect(html).toContain('<nav class="avc-tabbar n-tb" data-node="tb" aria-label="Main">');
    expect((html.match(/class="avc-tab[" ]/g) ?? []).length).toBe(3);
    expect((html.match(/<svg/g) ?? []).length).toBe(3);
    expect(html).toContain("<span>Classes</span>");
  });
  it("marks the tab for the page you are on, using that page's own path", () => {
    const pages = [page("p_classes", "/classes"), page("p_me", "/me")];
    const p = app([tabs], "mobile", pages);
    const cur = (pageId: string) => [...renderPage(p, pageId).html.matchAll(/class="avc-tab avc-tab-on" href="([^"]*)" aria-current="page"/g)].map((m) => m[1]);
    expect(cur("page_home")).toEqual(["/"]);
    expect(cur("p_classes")).toEqual(["/classes"]);
    expect(cur("p_me")).toEqual(["/me#top"]); // a #fragment on the link doesn't stop it matching
  });
  it("highlights nothing for an outside or anchor-only link", () => {
    const t = block("tb", "tabBar", { items: [{ label: "A", href: "https://example.com", icon: "home" }, { label: "B", href: "#x", icon: "home" }] });
    expect(renderPage(app([t]), "page_home").html).not.toContain("avc-tab-on");
  });
  it("is fixed to the bottom with room left for it and the phone's safe area", () => {
    const css = renderPage(app([tabs]), "page_home").css;
    expect(css).toContain(".avc-tabbar{position:fixed;");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/body:has\(\.avc-tabbar\)\{padding-bottom/);
  });
  it("tab targets are at least 44px tall", () => {
    expect(renderPage(app([tabs]), "page_home").css).toMatch(/\.avc-tab\{[^}]*min-height:48px/);
  });
});

describe("appList", () => {
  const items = [{ title: "Maths", subtitle: "9 am", icon: "book", href: "/classes", badge: "New" }, { title: "Static row" }];
  it("links the tappable rows, shows badges and icons, and leaves plain rows unlinked", () => {
    const html = renderPage(app([block("l", "appList", { title: "Today", items }, "inset")]), "page_home").html;
    expect(html).toContain("<h2>Today</h2>");
    expect(html).toContain('<a class="avc-row" href="/classes">');
    expect(html).toContain('<span class="avc-row-b">New</span>');
    expect(html).toContain("avc-row-ic");
    expect(html).toContain('<div class="avc-row"><span class="avc-row-t"><strong>Static row</strong>');
    expect((html.match(/avc-row-go/g) ?? []).length).toBe(1); // only the linked row gets the arrow
  });
  it("rows are at least 56px tall (easy to tap)", () => {
    expect(renderPage(app([block("l", "appList", { items })]), "page_home").css).toMatch(/\.avc-row\{[^}]*min-height:56px/);
  });
});

describe("the page itself", () => {
  const doc = (platform: Project["platform"]) => renderDocument(app([block("h", "appHeader", { title: "Home" })], platform), "page_home");
  it("a mobile-only app is a phone-width column; web+mobile and web are not", () => {
    expect(doc("mobile")).toContain('<body class="avc-app">');
    expect(doc("web+mobile")).not.toContain("avc-app\"");
    expect(doc("web")).not.toContain("avc-app\"");
  });
  it("app projects cover the whole screen on phones with a notch (viewport-fit); web projects keep the plain viewport", () => {
    expect(doc("mobile")).toContain("initial-scale=1,viewport-fit=cover");
    expect(doc("web+mobile")).toContain("viewport-fit=cover");
    expect(doc("web")).toContain('content="width=device-width,initial-scale=1">');
  });
});
