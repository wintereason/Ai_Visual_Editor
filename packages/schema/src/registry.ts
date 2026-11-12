import { z } from "zod";
import type { NodeKind, StyleGroup } from "./types";
import { CHART_TYPES, ICON_NAMES, SHAPE_NAMES } from "./graphics";

// z.enum (not a free string) so the Inspector offers these as a dropdown
const iconName = z.enum(ICON_NAMES as [string, ...string[]]);
const shapeName = z.enum(SHAPE_NAMES as [string, ...string[]]);

export type ChildRule = "none" | "any" | readonly string[];

export type NodeDef = {
  type: string;
  kind: NodeKind;
  props: z.ZodTypeAny;
  /** Which child types may be nested. "any" = anything except sections. */
  children: ChildRule;
  styleGroups: readonly StyleGroup[];
  variants?: readonly string[];
  animatable: boolean;
  /** Only valid as a top-level page node. */
  topLevelOnly?: boolean;
};

const safeUrl = z
  .string()
  .refine((u) => /^(https?:|mailto:|tel:|#|\/)/i.test(u.trim()), "url must be http(s), mailto, tel, #, or relative");
const text = z.string().max(2000);

// Spec 15.1: embeds are limited to an allow-list, always https. The publisher's CSP frame-src mirrors this list.
export const EMBED_ORIGINS: Record<"youtube" | "map", readonly { host: string; pathPrefix?: string }[]> = {
  youtube: [{ host: "www.youtube.com", pathPrefix: "/embed/" }, { host: "www.youtube-nocookie.com", pathPrefix: "/embed/" }],
  map: [{ host: "www.google.com", pathPrefix: "/maps/embed" }, { host: "www.openstreetmap.org", pathPrefix: "/export/embed" }],
};
const EMBED_HINT = {
  youtube: "https://www.youtube.com/embed/... or https://www.youtube-nocookie.com/embed/...",
  map: "https://www.google.com/maps/embed... or https://www.openstreetmap.org/export/embed...",
} as const;
export function embedAllowed(provider: "youtube" | "map", url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    return EMBED_ORIGINS[provider].some((o) => u.hostname === o.host && (!o.pathPrefix || u.pathname.startsWith(o.pathPrefix)));
  } catch {
    return false;
  }
}
export const LAYER_ASPECTS = ["1 / 1", "4 / 3", "3 / 2", "16 / 9", "3 / 4", "2 / 3", "9 / 16"] as const;
const empty = z.object({}).strict();

// Non-destructive image edits (spec 11.2): stored as parameters, applied at render time; the uploaded file is never changed.
// Percentages: 100 = unchanged for brightness / contrast / saturation; grayscale 0..100; blur in px.
export const IMAGE_ADJUST = z
  .object({
    brightness: z.number().min(0).max(200),
    contrast: z.number().min(0).max(200),
    saturation: z.number().min(0).max(200),
    grayscale: z.number().min(0).max(100),
    blur: z.number().min(0).max(20),
  })
  .partial()
  .strict();

const ALL: StyleGroup[] = ["layout", "size", "spacing", "background", "border", "effects", "typography", "visibility", "position"];
const BOX: StyleGroup[] = ["size", "spacing", "background", "border", "effects", "visibility"];
const TEXT: StyleGroup[] = ["size", "spacing", "typography", "effects", "visibility"];

const defs: NodeDef[] = [
  // structure
  { type: "section", kind: "container", props: empty, children: "any", styleGroups: ALL, animatable: true, topLevelOnly: true },
  // 11.4: a fixed-shape canvas whose children are layers placed by percentage, so the whole composition scales together
  { type: "layerGroup", kind: "layerGroup", props: z.object({ aspect: z.enum(LAYER_ASPECTS).default("16 / 9"), label: z.string().max(200).optional() }).strict(), children: "any", styleGroups: ["size", "spacing", "background", "border", "effects", "visibility"], animatable: true },
  { type: "container", kind: "container", props: empty, children: "any", styleGroups: ALL, animatable: true },

  // elements (MVP 12)
  { type: "heading", kind: "element", props: z.object({ text, level: z.number().int().min(1).max(6).default(2) }).strict(), children: "none", styleGroups: TEXT, animatable: true },
  { type: "text", kind: "element", props: z.object({ text }).strict(), children: "none", styleGroups: TEXT, animatable: true },
  { type: "button", kind: "element", props: z.object({ label: z.string().max(80), href: safeUrl.optional() }).strict(), children: "none", variants: ["solid", "outline", "ghost"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "image", kind: "element", props: z.object({ assetId: z.string().optional(), src: safeUrl.optional(), alt: z.string().max(300), fit: z.enum(["cover", "contain"]).default("cover"), adjust: IMAGE_ADJUST.optional(), mask: z.enum(["circle", "rounded"]).optional() }).strict(), children: "none", styleGroups: ["size", "spacing", "border", "effects", "visibility"], animatable: true },
  { type: "video", kind: "element", props: z.object({ assetId: z.string().optional(), src: safeUrl.optional(), poster: safeUrl.optional(), autoplay: z.boolean().default(false) }).strict(), children: "none", styleGroups: ["size", "spacing", "border", "effects", "visibility"], animatable: true },
  { type: "icon", kind: "element", props: z.object({ name: iconName }).strict(), children: "none", styleGroups: ["size", "spacing", "typography", "effects", "visibility"], animatable: true },
  { type: "shape", kind: "element", props: z.object({ shape: shapeName, label: z.string().max(120).optional() }).strict(), children: "none", styleGroups: ["size", "spacing", "typography", "effects", "visibility"], animatable: true },
  { type: "chart", kind: "element", props: z.object({ chartType: z.enum(CHART_TYPES), title: z.string().max(120).optional(), data: z.array(z.object({ label: z.string().max(40), value: z.number().min(0).max(1_000_000_000) }).strict()).min(1).max(12) }).strict(), children: "none", styleGroups: ["size", "spacing", "background", "border", "effects", "visibility", "typography"], animatable: true },
  { type: "table", kind: "element", props: z.object({ columns: z.array(z.string().max(60)).min(1).max(6), rows: z.array(z.string().max(400)).max(30), caption: z.string().max(120).optional() }).strict().superRefine((p, ctx) => {
    // A row is its cells joined by " | ". Too many cells would be silently cut off, so say so instead.
    p.rows.forEach((r, i) => { if (r.split("|").length > p.columns.length) ctx.addIssue({ code: "custom", path: ["rows", i], message: `row ${i + 1} has more cells than there are columns (${p.columns.length})` }); });
  }), children: "none", styleGroups: ["size", "spacing", "background", "border", "effects", "typography", "visibility"], animatable: true },
  { type: "divider", kind: "element", props: empty, children: "none", styleGroups: ["size", "spacing", "border", "visibility"], animatable: false },
  { type: "spacer", kind: "element", props: empty, children: "none", styleGroups: ["size", "visibility"], animatable: false },
  { type: "link", kind: "element", props: z.object({ text, href: safeUrl }).strict(), children: "none", styleGroups: TEXT, animatable: true },
  { type: "input", kind: "element", props: z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/), label: z.string().max(100), inputType: z.enum(["text", "email", "tel", "number"]).default("text"), required: z.boolean().default(false) }).strict(), children: "none", styleGroups: [...BOX, "typography"], animatable: false },
  { type: "list", kind: "element", props: z.object({ items: z.array(z.string().max(300)).max(30), ordered: z.boolean().default(false) }).strict(), children: "none", styleGroups: TEXT, animatable: true },
  { type: "embed", kind: "element", props: z.object({ provider: z.enum(["youtube", "map"]), url: safeUrl }).strict().superRefine((p, ctx) => {
    if (!embedAllowed(p.provider, p.url)) ctx.addIssue({ code: "custom", path: ["url"], message: `${p.provider} embeds must use an allowed address (${EMBED_HINT[p.provider]})` });
  }), children: "none", styleGroups: ["size", "spacing", "border", "visibility"], animatable: false },

  // blocks (initial set)
  { type: "navbar", kind: "block", props: z.object({ brand: z.string().max(60), links: z.array(z.object({ label: z.string().max(40), href: safeUrl }).strict()).max(8), ctaLabel: z.string().max(40).optional(), ctaHref: safeUrl.optional() }).strict(), children: "none", variants: ["simple", "centered", "cta"], styleGroups: [...BOX, "position"], animatable: false },
  { type: "hero", kind: "block", props: z.object({ headline: text, subheadline: text.optional(), ctaLabel: z.string().max(40).optional(), ctaHref: safeUrl.optional(), imageAssetId: z.string().optional() }).strict(), children: "none", variants: ["centered", "split", "minimal"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "featureGrid", kind: "block", props: z.object({ title: text.optional(), items: z.array(z.object({ icon: z.string().optional(), title: z.string().max(80), body: z.string().max(300) }).strict()).min(1).max(12) }).strict(), children: "none", variants: ["cards", "plain"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "testimonial", kind: "block", props: z.object({ quote: text, author: z.string().max(80), role: z.string().max(80).optional() }).strict(), children: "none", variants: ["card", "quote"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "contactForm", kind: "block", props: z.object({ title: text.optional(), submitLabel: z.string().max(40).default("Send") }).strict(), children: "none", variants: ["simple"], styleGroups: [...BOX, "typography"], animatable: false },
  { type: "footer", kind: "block", props: z.object({ copyright: z.string().max(120), links: z.array(z.object({ label: z.string().max(40), href: safeUrl }).strict()).max(10).default([]) }).strict(), children: "none", variants: ["simple", "columns"], styleGroups: [...BOX, "typography"], animatable: false },
  // more blocks
  { type: "stats", kind: "block", props: z.object({ title: text.optional(), items: z.array(z.object({ value: z.string().max(20), label: z.string().max(80) }).strict()).min(1).max(6) }).strict(), children: "none", variants: ["row", "cards"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "steps", kind: "block", props: z.object({ title: text.optional(), items: z.array(z.object({ title: z.string().max(80), body: z.string().max(300) }).strict()).min(2).max(8) }).strict(), children: "none", variants: ["horizontal", "vertical"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "faq", kind: "block", props: z.object({ title: text.optional(), items: z.array(z.object({ question: z.string().max(200), answer: z.string().max(1000) }).strict()).min(1).max(20) }).strict(), children: "none", variants: ["simple"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "pricing", kind: "block", props: z.object({ title: text.optional(), plans: z.array(z.object({ name: z.string().max(40), price: z.string().max(20), period: z.string().max(20).optional(), features: z.array(z.string().max(120)).max(10), ctaLabel: z.string().max(40).optional(), ctaHref: safeUrl.optional(), highlighted: z.boolean().optional() }).strict()).min(1).max(4) }).strict(), children: "none", variants: ["cards"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "team", kind: "block", props: z.object({ title: text.optional(), members: z.array(z.object({ name: z.string().max(60), role: z.string().max(60).optional(), bio: z.string().max(300).optional(), imageAssetId: z.string().optional() }).strict()).min(1).max(12) }).strict(), children: "none", variants: ["cards", "plain"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "logoStrip", kind: "block", props: z.object({ title: text.optional(), logos: z.array(z.object({ name: z.string().max(60), imageAssetId: z.string().optional() }).strict()).min(1).max(10) }).strict(), children: "none", variants: ["simple"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "ctaBanner", kind: "block", props: z.object({ headline: text, subheadline: text.optional(), ctaLabel: z.string().max(40), ctaHref: safeUrl }).strict(), children: "none", variants: ["primary", "surface"], styleGroups: [...BOX, "typography"], animatable: true },
  // app-style blocks (platform "mobile"): a screen header, a bottom tab bar, and tappable list rows
  { type: "appHeader", kind: "block", props: z.object({ title: z.string().max(60), subtitle: z.string().max(100).optional(), backHref: safeUrl.optional(), actionLabel: z.string().max(20).optional(), actionHref: safeUrl.optional() }).strict(), children: "none", variants: ["plain", "colored"], styleGroups: [...BOX, "typography"], animatable: false },
  { type: "tabBar", kind: "block", props: z.object({ items: z.array(z.object({ label: z.string().max(16), href: safeUrl, icon: iconName.default("home") }).strict()).min(2).max(5) }).strict(), children: "none", variants: ["bottom"], styleGroups: ["spacing", "background", "border", "effects", "visibility", "typography"], animatable: false },
  { type: "appList", kind: "block", props: z.object({ title: z.string().max(80).optional(), items: z.array(z.object({ title: z.string().max(80), subtitle: z.string().max(120).optional(), icon: iconName.optional(), href: safeUrl.optional(), badge: z.string().max(12).optional() }).strict()).min(1).max(20) }).strict(), children: "none", variants: ["inset", "plain"], styleGroups: [...BOX, "typography"], animatable: true },
  { type: "gallery", kind: "block", props: z.object({ title: text.optional(), images: z.array(z.object({ assetId: z.string().optional(), src: safeUrl.optional(), alt: z.string().max(300) }).strict().refine((i) => !!(i.assetId || i.src), { message: "each gallery image needs an uploaded file or an image address" })).min(1).max(12) }).strict(), children: "none", variants: ["grid"], styleGroups: [...BOX, "typography"], animatable: true },
];

export const REGISTRY: ReadonlyMap<string, NodeDef> = new Map(defs.map((d) => [d.type, d]));

export function getDef(type: string): NodeDef | undefined {
  return REGISTRY.get(type);
}

export function canContain(parentType: string, childType: string): boolean {
  const parent = REGISTRY.get(parentType);
  const child = REGISTRY.get(childType);
  if (!parent || !child || child.topLevelOnly) return false;
  if (parent.children === "none") return false;
  if (parent.children === "any") return true;
  return parent.children.includes(childType);
}
