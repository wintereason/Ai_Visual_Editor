import type { Node, Page, Project, Styles } from "@avc/schema";

/** Small builders so template files read like the page they describe. */
export function makeIds(prefix: string) {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

type Ctx = ReturnType<typeof makeIds>;
const pad = (v: "sm" | "md" | "lg" | "xl") => ({ top: v, right: v, bottom: v, left: v });

export function section(id: Ctx, children: Node[], styles?: Styles): Node {
  return { id: id(), kind: "container", type: "section", props: {}, children, ...(styles ? { styles } : {}) };
}
export function band(id: Ctx, children: Node[], opts: { bg?: string; color?: string; align?: "left" | "center" | "right"; padding?: string } = {}): Node {
  const normal: Record<string, unknown> = { padding: { top: opts.padding ?? "xl", bottom: opts.padding ?? "xl", left: "lg", right: "lg" } };
  if (opts.bg) normal.background = opts.bg;
  if (opts.color) normal.color = opts.color;
  if (opts.align) normal.textAlign = opts.align;
  return section(id, children, { base: { normal: normal as any }, mobile: { normal: { padding: { top: "lg", bottom: "lg", left: "md", right: "md" } } } });
}
export const heading = (id: Ctx, text: string, level = 2, extra: Partial<Node> = {}): Node => ({ id: id(), kind: "element", type: "heading", props: { text, level }, ...extra });
export const text = (id: Ctx, t: string, extra: Partial<Node> = {}): Node => ({ id: id(), kind: "element", type: "text", props: { text: t }, ...extra });
export const button = (id: Ctx, label: string, href: string, variant = "solid", styles?: Styles): Node => ({
  id: id(), kind: "element", type: "button", variant, props: { label, href }, ...(styles ? { styles } : {}),
});
export const list = (id: Ctx, items: string[]): Node => ({ id: id(), kind: "element", type: "list", props: { items, ordered: false } });
export const row = (id: Ctx, children: Node[], gap = "lg"): Node => ({
  id: id(), kind: "container", type: "container", props: {}, children,
  styles: { base: { normal: { display: "flex", direction: "row", gap: gap as any, wrap: true, align: "start" } }, mobile: { normal: { direction: "column" } } },
});
export const card = (id: Ctx, children: Node[]): Node => ({
  id: id(), kind: "container", type: "container", props: {}, children,
  styles: { base: { normal: { background: "theme.surface", padding: pad("lg"), radius: { tl: "lg", tr: "lg", br: "lg", bl: "lg" }, minHeight: { value: 120, unit: "px" } } } },
});
export const block = (id: Ctx, type: string, variant: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({
  id: id(), kind: "block", type, variant, props, ...extra,
});
export const fade = { preset: "fade-in", trigger: "scroll" } as const;

export function page(id: string, name: string, path: string, title: string, description: string, nodes: Node[]): Page {
  return { id, name, path, seo: { title, description }, nodes };
}

export function blankProject(): Project {
  return {
    schemaVersion: 2, id: "proj_blank", name: "Untitled project", platform: "web",
    theme: {
      colors: { primary: "#1d4ed8", secondary: "#f59e0b", background: "#ffffff", surface: "#f1f5f9", text: "#0f172a", muted: "#475569" },
      fonts: { heading: "Poppins", body: "Inter" }, radius: "md", motion: "subtle",
    },
    pages: [{ id: "page_home", name: "Home", path: "/", seo: { title: "Home" }, nodes: [{ id: "sec_blank", kind: "container", type: "section", props: {}, children: [] }] }],
  };
}

/** Deep-clone a project giving every project, page and node a fresh id (templates are never edited in place). */
export function cloneProject(project: Project, gen: () => string): Project {
  const reNode = (n: Node): Node => ({ ...structuredClone(n), id: gen(), children: n.children?.map(reNode) });
  return {
    ...structuredClone(project),
    id: gen(),
    pages: project.pages.map((p) => ({ ...structuredClone(p), id: gen(), nodes: p.nodes.map(reNode) })),
  };
}

type Link = { label: string; href: string };

/** Shared nav / footer / call-to-action so each template only describes its own pages. */
export function siteKit(id: () => string, brand: string, links: Link[], ctaLabel: string, ctaHref: string) {
  return {
    nav: (): Node => section(id, [block(id, "navbar", "cta", { brand, links, ctaLabel, ctaHref })]),
    foot: (): Node =>
      section(id, [block(id, "footer", "simple", { copyright: `© ${brand}. All rights reserved.`, links })], { base: { normal: { background: "theme.surface" } } }),
    cta: (title: string, sub: string, label = ctaLabel, href = ctaHref): Node =>
      band(id, [
        heading(id, title, 2, { animation: fade }),
        text(id, sub),
        button(id, label, href, "solid", { base: { normal: { background: "#ffffff", color: "theme.primary" } } }),
      ], { bg: "theme.primary", color: "#ffffff", align: "center" }),
    hero: (variant: "split" | "centered" | "minimal", headline: string, sub: string, label?: string, href?: string, load = false): Node =>
      section(id, [block(id, "hero", variant, { headline, subheadline: sub, ...(label ? { ctaLabel: label, ctaHref: href } : {}) }, load ? { animation: { preset: "fade-in", trigger: "load" } } : {})]),
    grid: (title: string, items: { title: string; body: string }[], variant: "cards" | "plain" = "cards"): Node =>
      section(id, [block(id, "featureGrid", variant, { title, items }, { animation: fade })]),
    stats: (title: string, items: { value: string; label: string }[], variant: "row" | "cards" = "row"): Node =>
      band(id, [block(id, "stats", variant, { title, items }, { animation: fade })], { bg: "theme.surface", align: "center" }),
    steps: (title: string, items: { title: string; body: string }[], variant: "horizontal" | "vertical" = "horizontal"): Node =>
      section(id, [block(id, "steps", variant, { title, items }, { animation: fade })]),
    faq: (title: string, items: { question: string; answer: string }[]): Node => section(id, [block(id, "faq", "simple", { title, items })]),
    pricing: (title: string, plans: Record<string, unknown>[]): Node => section(id, [block(id, "pricing", "cards", { title, plans }, { animation: fade })]),
    team: (title: string, members: { name: string; role?: string; bio?: string }[]): Node => section(id, [block(id, "team", "cards", { title, members }, { animation: fade })]),
    info: (title: string, lines: string[], note?: string): Node =>
      band(id, [heading(id, title, 2), ...(note ? [text(id, note)] : []), list(id, lines)], { bg: "theme.surface" }),
    quotes: (title: string, a: [string, string, string], b: [string, string, string]): Node =>
      band(id, [
        heading(id, title, 2),
        row(id, [
          card(id, [block(id, "testimonial", "card", { quote: a[0], author: a[1], role: a[2] })]),
          card(id, [block(id, "testimonial", "card", { quote: b[0], author: b[1], role: b[2] })]),
        ]),
      ], { align: "center" }),
    contact: (title: string, sub: string, formTitle: string, submit: string, details: string[]): Node[] => [
      band(id, [heading(id, title, 1), text(id, sub)], { align: "center" }),
      section(id, [block(id, "contactForm", "simple", { title: formTitle, submitLabel: submit })]),
      band(id, [heading(id, "Visit us", 2), list(id, details)], { bg: "theme.surface" }),
    ],
  };
}

export function makeProject(pid: string, name: string, colors: { primary: string; secondary: string }, heading: string, pages: Page[]): Project {
  return {
    schemaVersion: 2, id: pid, name, platform: "web",
    theme: {
      colors: { primary: colors.primary, secondary: colors.secondary, background: "#ffffff", surface: "#f1f5f9", text: "#0f172a", muted: "#475569" },
      fonts: { heading, body: "Inter" }, radius: "md", motion: "subtle",
    },
    pages,
  };
}
