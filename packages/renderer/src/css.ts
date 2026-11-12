import type { StyleProps, Styles, Theme } from "@avc/schema";

export const BREAKPOINT_MAX = { tablet: 1024, mobile: 640 } as const;

const SPACE: Record<string, string> = { none: "0", xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "48px", "2xl": "80px" };
const FONT: Record<string, string> = { none: "0", xs: "12px", sm: "14px", md: "16px", lg: "20px", xl: "28px", "2xl": "44px" };
const RADIUS: Record<string, string> = { none: "0", xs: "2px", sm: "4px", md: "8px", lg: "16px", xl: "24px", "2xl": "32px" };
const SHADOW: Record<string, string> = {
  none: "none", sm: "0 1px 2px rgba(0,0,0,.12)", md: "0 4px 12px rgba(0,0,0,.14)", lg: "0 12px 32px rgba(0,0,0,.18)",
};
const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };

const tok = (v: string | number, map: Record<string, string>) => (typeof v === "number" ? `${v}px` : map[v] ?? "0");
const unit = (v: { value: number; unit: string }) => `${v.value}${v.unit}`;
const color = (c: string) => (c.startsWith("theme.") ? `var(--c-${c.slice(6)})` : c);
const sides = (o: Record<string, any>, map: Record<string, string>, names: [string, string, string, string]) =>
  names.map((k) => (o[k] === undefined ? "0" : tok(o[k], map))).join(" ");

/** Convert one StyleProps object to declarations. Pure, no user string is emitted unvalidated. */
export type AssetUrl = (assetId: string) => string | undefined;

/** Only blob:, relative and http(s) URLs are emitted; quotes, parens, backslashes and spaces are percent-encoded so a URL can never break out of url(). */
export function safeCssUrl(u: string): string | null {
  if (!/^(blob:|https?:|\/)/i.test(u)) return null;
  return u.replace(/["'()<>\\\s]/g, (c) => encodeURIComponent(c).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29"));
}

export function styleToDecls(s: StyleProps, assetUrl?: AssetUrl): string[] {
  const d: string[] = [];
  if (s.display) d.push(`display:${s.display}`);
  if (s.direction) d.push(`flex-direction:${s.direction}`);
  if (s.gap !== undefined) d.push(`gap:${tok(s.gap, SPACE)}`);
  if (s.align) d.push(`align-items:${ALIGN[s.align]}`);
  if (s.justify) d.push(`justify-content:${JUSTIFY[s.justify]}`);
  if (s.columns) d.push(`grid-template-columns:repeat(${s.columns},minmax(0,1fr))`);
  if (s.wrap !== undefined) d.push(`flex-wrap:${s.wrap ? "wrap" : "nowrap"}`);
  if (s.width) d.push(`width:${s.width === "auto" ? "auto" : s.width === "fill" ? "100%" : unit(s.width)}`);
  if (s.maxWidth) d.push(`max-width:${unit(s.maxWidth)}`);
  if (s.minHeight) d.push(`min-height:${unit(s.minHeight)}`);
  if (s.aspectRatio) d.push(`aspect-ratio:${s.aspectRatio}`);
  if (s.padding) d.push(`padding:${sides(s.padding, SPACE, ["top", "right", "bottom", "left"])}`);
  if (s.margin) d.push(`margin:${sides(s.margin, SPACE, ["top", "right", "bottom", "left"])}`);
  if (s.background) {
    const b = s.background;
    if (typeof b === "string") d.push(`background:${color(b)}`);
    else if ("stops" in b) d.push(`background:linear-gradient(${b.angle}deg,${b.stops.map((x) => `${color(x.color)} ${x.at}%`).join(",")})`);
    else if ("assetId" in b) {
      const raw = assetUrl?.(b.assetId);
      const url = raw ? safeCssUrl(raw) : null;
      if (url) {
        const o = b.overlay ?? 0;
        d.push(`background:${o > 0 ? `linear-gradient(rgba(0,0,0,${o}),rgba(0,0,0,${o})),` : ""}url("${url}") center/${b.fit} no-repeat`);
      }
    }
  }
  if (s.border) d.push(`border:${s.border.width}px ${s.border.style} ${color(s.border.color)}`);
  if (s.radius) d.push(`border-radius:${sides(s.radius, RADIUS, ["tl", "tr", "br", "bl"])}`);
  if (s.shadow) d.push(`box-shadow:${SHADOW[s.shadow]}`);
  if (s.opacity !== undefined) d.push(`opacity:${s.opacity}`);
  if (s.backdropBlur) d.push(`backdrop-filter:blur(${s.backdropBlur}px)`);
  if (s.fontFamily) d.push(`font-family:var(--f-${s.fontFamily})`);
  if (s.fontSize !== undefined) d.push(`font-size:${tok(s.fontSize, FONT)}`);
  if (s.fontWeight) d.push(`font-weight:${s.fontWeight}`);
  if (s.lineHeight) d.push(`line-height:${s.lineHeight}`);
  if (s.letterSpacing !== undefined) d.push(`letter-spacing:${s.letterSpacing}px`);
  if (s.textAlign) d.push(`text-align:${s.textAlign}`);
  if (s.color) d.push(`color:${color(s.color)}`);
  if (s.hidden) d.push(`display:none`);
  if (s.position) d.push(`position:${s.position}`);
  return d;
}

/** Desktop-first cascade: base, then tablet (<=1024), then mobile (<=640); hover layered after normal. */
export function nodeCss(cls: string, styles: Styles | undefined, assetUrl?: AssetUrl): string {
  if (!styles) return "";
  const rule = (sel: string, s?: StyleProps) => {
    const d = s ? styleToDecls(s, assetUrl) : [];
    return d.length ? `${sel}{${d.join(";")}}` : "";
  };
  const level = (bp: "base" | "tablet" | "mobile") => {
    const body = rule(`.${cls}`, styles[bp]?.normal) + rule(`.${cls}:hover`, styles[bp]?.hover);
    if (!body) return "";
    return bp === "base" ? body : `@media (max-width:${BREAKPOINT_MAX[bp]}px){${body}}`;
  };
  return level("base") + level("tablet") + level("mobile");
}

export function themeCss(t: Theme): string {
  const c = Object.entries(t.colors).map(([k, v]) => `--c-${k}:${v}`).join(";");
  const font = (f: string) => f.replace(/[^a-zA-Z0-9 _-]/g, "");
  return `:root{${c};--f-heading:"${font(t.fonts.heading)}",sans-serif;--f-body:"${font(t.fonts.body)}",sans-serif}` +
    `body{margin:0;font-family:var(--f-body);color:var(--c-text);background:var(--c-background)}`;
}
