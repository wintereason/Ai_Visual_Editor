import type { Animation } from "./types";

export type AnimTrigger = "load" | "scroll" | "hover";
export type AnimGroup = "Entrance" | "Hover" | "Attention" | "Scroll";

export type AnimMeta = {
  preset: Animation["preset"];
  label: string;
  group: AnimGroup;
  /** Triggers that make sense for this preset; the first is the default. */
  triggers: readonly AnimTrigger[];
  /** If set, the preset only makes sense on these node types (text effects). */
  only?: readonly string[];
};

/** Presets the renderer actually implements. The schema still accepts the other names for forward compatibility. */
export const ANIMATIONS: readonly AnimMeta[] = [
  { preset: "fade-in", label: "Fade in", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "slide-up", label: "Slide up", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "slide-down", label: "Slide down", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "slide-left", label: "Slide left", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "slide-right", label: "Slide right", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "zoom-in", label: "Zoom in", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "rotate-in", label: "Rotate in", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "blur-in", label: "Blur in", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "reveal", label: "Wipe in", group: "Entrance", triggers: ["scroll", "load"] },
  { preset: "word-by-word", label: "Word by word", group: "Entrance", triggers: ["scroll", "load"], only: ["heading", "text"] },
  { preset: "typewriter", label: "Typewriter", group: "Entrance", triggers: ["scroll", "load"], only: ["heading", "text"] },
  { preset: "hover-lift", label: "Lift", group: "Hover", triggers: ["hover"] },
  { preset: "hover-scale", label: "Scale", group: "Hover", triggers: ["hover"] },
  { preset: "hover-tilt", label: "Tilt", group: "Hover", triggers: ["hover"] },
  { preset: "hover-glow", label: "Glow", group: "Hover", triggers: ["hover"] },
  { preset: "float", label: "Float", group: "Attention", triggers: ["load"] },
  { preset: "shimmer", label: "Shimmer", group: "Attention", triggers: ["load"], only: ["heading", "text"] },
  { preset: "pulse", label: "Pulse", group: "Attention", triggers: ["load"] },
  { preset: "marquee", label: "Marquee", group: "Attention", triggers: ["load"], only: ["heading", "text"] },
  // Moves a little as the visitor scrolls (a depth effect). Its trigger is "scroll" so the page loads the scroll runtime.
  { preset: "parallax", label: "Parallax", group: "Scroll", triggers: ["scroll"] },
];

export const animMeta = (preset: string): AnimMeta | undefined => ANIMATIONS.find((a) => a.preset === preset);

/** The trigger actually used: the requested one if valid for the preset, otherwise the preset's default. */
export function effectiveTrigger(a: Animation): AnimTrigger {
  const m = animMeta(a.preset);
  if (!m) return a.trigger ?? "scroll";
  return a.trigger && m.triggers.includes(a.trigger) ? a.trigger : m.triggers[0]!;
}
