import { z } from "zod";

// ---------- Style v2 (spec 9.3) ----------
export const BREAKPOINTS = ["base", "tablet", "mobile"] as const;
export const STYLE_STATES = ["normal", "hover"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
export type StyleState = (typeof STYLE_STATES)[number];

const token = z.union([z.enum(["none", "xs", "sm", "md", "lg", "xl", "2xl"]), z.number()]);
const unitValue = (units: [string, ...string[]]) =>
  z.object({ value: z.number(), unit: z.enum(units as [string, ...string[]]) }).strict();
const sides = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ top: t.optional(), right: t.optional(), bottom: t.optional(), left: t.optional() }).strict();
const corners = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ tl: t.optional(), tr: t.optional(), br: t.optional(), bl: t.optional() }).strict();

const colorRef = z.string().regex(/^(#[0-9a-fA-F]{3,8}|theme\.[a-zA-Z]+)$/, "color must be hex or theme.<name>");
const gradient = z
  .object({
    type: z.literal("linear"),
    angle: z.number().min(0).max(360),
    stops: z.array(z.object({ color: colorRef, at: z.number().min(0).max(100) }).strict()).min(2).max(5),
  })
  .strict();

export const StylePropsSchema = z
  .object({
    display: z.enum(["block", "flex", "grid"]),
    direction: z.enum(["row", "column"]),
    gap: token,
    align: z.enum(["start", "center", "end", "stretch"]),
    justify: z.enum(["start", "center", "end", "between"]),
    columns: z.number().int().min(1).max(6),
    wrap: z.boolean(),
    width: z.union([z.enum(["auto", "fill"]), unitValue(["px", "%", "rem"])]),
    maxWidth: unitValue(["px", "%", "rem"]),
    minHeight: unitValue(["px", "vh", "rem"]),
    aspectRatio: z.string().regex(/^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/),
    padding: sides(token),
    margin: sides(token),
    background: z.union([
      colorRef,
      gradient,
      z.object({ assetId: z.string(), fit: z.enum(["cover", "contain"]), overlay: z.number().min(0).max(1).optional() }).strict(),
    ]),
    border: z.object({ width: z.number().min(0).max(32), style: z.enum(["solid", "dashed"]), color: colorRef }).strict(),
    radius: corners(token),
    shadow: z.enum(["none", "sm", "md", "lg"]),
    opacity: z.number().min(0).max(1),
    backdropBlur: z.number().min(0).max(40),
    fontFamily: z.enum(["heading", "body"]),
    fontSize: token,
    fontWeight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]),
    lineHeight: z.number().min(0.8).max(3),
    letterSpacing: z.number().min(-5).max(20),
    textAlign: z.enum(["left", "center", "right"]),
    color: colorRef,
    hidden: z.boolean(),
    position: z.enum(["static", "sticky", "fixed"]),
  })
  .partial()
  .strict();
export type StyleProps = z.infer<typeof StylePropsSchema>;
export const STYLE_KEYS = Object.keys(StylePropsSchema.shape) as (keyof StyleProps)[];

const stateMap = z.object({ normal: StylePropsSchema.optional(), hover: StylePropsSchema.optional() }).strict();
export const StylesSchema = z
  .object({ base: stateMap.optional(), tablet: stateMap.optional(), mobile: stateMap.optional() })
  .strict();
export type Styles = z.infer<typeof StylesSchema>;

/** Style groups used by the registry to limit which style keys a node type may carry (spec 7.3). */
export const STYLE_GROUPS = {
  layout: ["display", "direction", "gap", "align", "justify", "columns", "wrap"],
  size: ["width", "maxWidth", "minHeight", "aspectRatio"],
  spacing: ["padding", "margin"],
  background: ["background"],
  border: ["border", "radius"],
  effects: ["shadow", "opacity", "backdropBlur"],
  typography: ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "color"],
  visibility: ["hidden"],
  position: ["position"],
} as const satisfies Record<string, readonly (keyof StyleProps)[]>;
export type StyleGroup = keyof typeof STYLE_GROUPS;

// ---------- Animation (spec 9.4) ----------
export const ANIMATION_PRESETS = [
  "fade-in", "slide-up", "slide-left", "slide-right", "slide-down", "zoom-in", "rotate-in", "blur-in",
  "parallax", "reveal", "pin", "hover-lift", "hover-glow", "hover-scale", "hover-tilt",
  "float", "pulse", "marquee", "typewriter", "word-by-word", "shimmer", "lottie",
] as const;
export const AnimationSchema = z
  .object({
    preset: z.enum(ANIMATION_PRESETS),
    trigger: z.enum(["load", "scroll", "hover"]).optional(),
    durationMs: z.number().min(100).max(3000).optional(),
    delayMs: z.number().min(0).max(3000).optional(),
    lottieAssetId: z.string().optional(),
  })
  .strict();
export type Animation = z.infer<typeof AnimationSchema>;

// ---------- Nodes / project (spec 9.1, 9.2) ----------
export const NODE_KINDS = ["element", "block", "container", "componentRef", "layerGroup"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Where a layer sits inside a layerGroup, as percentages of the group: x/y of its top-left corner, w = its width, r = rotation in degrees. */
export const PlaceSchema = z
  .object({ x: z.number().min(-50).max(150), y: z.number().min(-50).max(150), w: z.number().min(1).max(300), r: z.number().min(-180).max(180).optional() })
  .strict();
export type Place = z.infer<typeof PlaceSchema>;

export type Node = {
  id: string;
  kind: NodeKind;
  type: string;
  variant?: string;
  props: Record<string, unknown>;
  styles?: Styles;
  animation?: Animation;
  /** Only for direct children of a layerGroup. */
  place?: Place;
  children?: Node[];
};

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(64),
      kind: z.enum(NODE_KINDS),
      type: z.string().min(1),
      variant: z.string().optional(),
      props: z.record(z.unknown()),
      styles: StylesSchema.optional(),
      animation: AnimationSchema.optional(),
      place: PlaceSchema.optional(),
      children: z.array(NodeSchema).optional(),
    })
    .strict(),
);

export const ThemeSchema = z
  .object({
    colors: z.object({
      primary: colorRef, secondary: colorRef, background: colorRef,
      surface: colorRef, text: colorRef, muted: colorRef,
    }).strict(),
    fonts: z.object({ heading: z.string(), body: z.string() }).strict(),
    radius: z.enum(["none", "sm", "md", "lg", "full"]),
    motion: z.enum(["off", "subtle", "full"]),
  })
  .strict();
export type Theme = z.infer<typeof ThemeSchema>;

/** The person's saved identity: name, logo, and their own colours and font pairs, kept with the project. */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "brand colours are 6-digit hex like #1D4ED8");
export const BrandSchema = z
  .object({
    name: z.string().max(60).optional(),
    logoAssetId: z.string().optional(),
    colors: z.array(hexColor).max(12).optional(),
    fonts: z.array(z.object({ heading: z.string().max(60), body: z.string().max(60) }).strict()).max(6).optional(),
  })
  .strict();
export type Brand = z.infer<typeof BrandSchema>;

/** Settings for the installable app version of a site (a PWA). Only used when the project's platform is "mobile" or "web+mobile". */
export const APP_DISPLAYS = ["standalone", "minimal-ui", "browser"] as const;
export const AppSchema = z
  .object({
    shortName: z.string().max(12).optional(),
    themeColor: hexColor.optional(),
    backgroundColor: hexColor.optional(),
    display: z.enum(APP_DISPLAYS).optional(),
    iconAssetId: z.string().optional(),
    /** Work without a connection once visited. On unless set to false. */
    offline: z.boolean().optional(),
  })
  .strict();
export type AppSettings = z.infer<typeof AppSchema>;

export const PageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    path: z.string().regex(/^\/[a-z0-9\-\/]*$/),
    seo: z.object({ title: z.string().optional(), description: z.string().optional() }).strict().optional(),
    nodes: z.array(NodeSchema), // top-level nodes are sections
  })
  .strict();
export type Page = z.infer<typeof PageSchema>;

export const SCHEMA_VERSION = 2 as const;
export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    platform: z.enum(["web", "mobile", "web+mobile"]),
    theme: ThemeSchema,
    brand: BrandSchema.optional(),
    app: AppSchema.optional(),
    pages: z.array(PageSchema).min(1),
  })
  .strict();
export type Project = z.infer<typeof ProjectSchema>;

// ---------- Patch (spec 9.8) ----------
// `styles: null` clears all styles; a `null` leaf inside styles removes that override.
export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update"),
    id: z.string(),
    props: z.record(z.unknown()).optional(),
    variant: z.string().optional(),
    styles: z.union([z.record(z.unknown()), z.null()]).optional(),
    animation: z.union([AnimationSchema, z.null()]).optional(),
    // Merged into the layer's current placement; null takes it out of the group's layout.
    place: z.union([PlaceSchema.partial(), z.null()]).optional(),
  }).strict(),
  z.object({ op: z.literal("insert"), parentId: z.string(), index: z.number().int().min(0), node: NodeSchema }).strict(),
  z.object({ op: z.literal("remove"), id: z.string() }).strict(),
  z.object({ op: z.literal("addPage"), page: PageSchema, index: z.number().int().min(0).optional() }).strict(),
  z.object({ op: z.literal("removePage"), id: z.string() }).strict(),
  z.object({
    op: z.literal("updatePage"),
    id: z.string(),
    name: z.string().min(1).optional(),
    path: PageSchema.shape.path.optional(),
    seo: z.object({ title: z.string().optional(), description: z.string().optional() }).strict().optional(),
  }).strict(),
  z.object({
    op: z.literal("setTheme"),
    theme: z.object({
      colors: ThemeSchema.shape.colors.partial().optional(),
      fonts: ThemeSchema.shape.fonts.partial().optional(),
      radius: ThemeSchema.shape.radius.optional(),
      motion: ThemeSchema.shape.motion.optional(),
    }).strict(),
  }).strict(),
  z.object({ op: z.literal("move"), id: z.string(), parentId: z.string(), index: z.number().int().min(0) }).strict(),
  z.object({ op: z.literal("setPlatform"), platform: z.enum(["web", "mobile", "web+mobile"]) }).strict(),
  // A null value removes that setting (it goes back to its default).
  z.object({
    op: z.literal("setApp"),
    app: z.object({
      shortName: AppSchema.shape.shortName.nullable().optional(),
      themeColor: AppSchema.shape.themeColor.nullable().optional(),
      backgroundColor: AppSchema.shape.backgroundColor.nullable().optional(),
      display: AppSchema.shape.display.nullable().optional(),
      iconAssetId: z.string().nullable().optional(),
      offline: z.boolean().nullable().optional(),
    }).strict(),
  }).strict(),
  // A null value removes that part of the brand kit.
  z.object({
    op: z.literal("setBrand"),
    brand: z.object({
      name: BrandSchema.shape.name.nullable().optional(),
      logoAssetId: z.string().nullable().optional(),
      colors: BrandSchema.shape.colors.nullable().optional(),
      fonts: BrandSchema.shape.fonts.nullable().optional(),
    }).strict(),
  }).strict(),
]);
export const PatchSchema = z
  .object({ summary: z.string().min(1).max(300), ops: z.array(PatchOpSchema).min(1).max(20) })
  .strict();
export type PatchOp = z.infer<typeof PatchOpSchema>;
export type Patch = z.infer<typeof PatchSchema>;
