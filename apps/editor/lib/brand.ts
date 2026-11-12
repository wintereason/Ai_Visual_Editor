import { contrastRatio } from "@avc/schema";

export type PaletteDef = { name: string; colors: { primary: string; secondary: string; background: string; surface: string; text: string; muted: string } };
/** Each one passes the readability checks the Theme panel uses (a test enforces it). */
export const PALETTES: PaletteDef[] = [
  { name: "Ocean", colors: { primary: "#1D4ED8", secondary: "#F59E0B", background: "#FFFFFF", surface: "#EFF6FF", text: "#0F172A", muted: "#475569" } },
  { name: "Forest", colors: { primary: "#166534", secondary: "#CA8A04", background: "#FFFFFF", surface: "#F0FDF4", text: "#14281D", muted: "#4B5563" } },
  { name: "Sunset", colors: { primary: "#C2410C", secondary: "#7C3AED", background: "#FFFBF5", surface: "#FFEDD5", text: "#2B1408", muted: "#57534E" } },
  { name: "Berry", colors: { primary: "#9D174D", secondary: "#0E7490", background: "#FFFFFF", surface: "#FDF2F8", text: "#1F1020", muted: "#52525B" } },
  { name: "Slate", colors: { primary: "#334155", secondary: "#0EA5E9", background: "#FFFFFF", surface: "#F1F5F9", text: "#0F172A", muted: "#475569" } },
  { name: "Royal", colors: { primary: "#5B21B6", secondary: "#F59E0B", background: "#FFFFFF", surface: "#F5F3FF", text: "#1E1B3A", muted: "#4B5563" } },
  { name: "Teal", colors: { primary: "#0F766E", secondary: "#F97316", background: "#FFFFFF", surface: "#F0FDFA", text: "#0B2B28", muted: "#475569" } },
  { name: "Maroon", colors: { primary: "#7F1D1D", secondary: "#B45309", background: "#FFFFFF", surface: "#FEF2F2", text: "#2A1212", muted: "#57534E" } },
  { name: "Midnight", colors: { primary: "#2563EB", secondary: "#F59E0B", background: "#0B1220", surface: "#162033", text: "#F1F5F9", muted: "#A8B3C7" } },
  { name: "Gold", colors: { primary: "#92400E", secondary: "#D97706", background: "#FAFAF9", surface: "#F5F5F4", text: "#1C1917", muted: "#57534E" } },
  { name: "Mint", colors: { primary: "#047857", secondary: "#2563EB", background: "#FFFFFF", surface: "#ECFDF5", text: "#052E21", muted: "#4B5563" } },
  { name: "Rose", colors: { primary: "#BE123C", secondary: "#1D4ED8", background: "#FFFFFF", surface: "#FFF1F2", text: "#2D0A12", muted: "#52525B" } },
];

/** Fonts the editor and the published site both know how to show. */
export const FONT_PAIRS: { name: string; heading: string; body: string }[] = [
  { name: "Modern", heading: "Poppins", body: "Inter" },
  { name: "Bold and clear", heading: "Montserrat", body: "Roboto" },
  { name: "Classic", heading: "Lora", body: "Inter" },
  { name: "Editorial", heading: "Georgia", body: "Roboto" },
  { name: "Friendly", heading: "Poppins", body: "Roboto" },
  { name: "Elegant", heading: "Lora", body: "Montserrat" },
  { name: "Plain", heading: "Inter", body: "Inter" },
  { name: "Print", heading: "Georgia", body: "Georgia" },
];

export type GradientDef = { name: string; angle: number; stops: { color: string; at: number }[] };
const g = (name: string, angle: number, ...cs: string[]): GradientDef => ({ name, angle, stops: cs.map((color, i) => ({ color, at: Math.round((i / (cs.length - 1)) * 100) })) });
export const GRADIENTS: GradientDef[] = [
  g("Ocean", 135, "#1D4ED8", "#06B6D4"), g("Sunset", 135, "#EA580C", "#DB2777"), g("Forest", 135, "#166534", "#65A30D"),
  g("Grape", 135, "#5B21B6", "#DB2777"), g("Night", 160, "#0F172A", "#334155"), g("Dawn", 180, "#FDE68A", "#FBCFE8"),
  g("Sky", 180, "#BFDBFE", "#FFFFFF"), g("Mint", 135, "#A7F3D0", "#BAE6FD"), g("Peach", 135, "#FED7AA", "#FBCFE8"),
  g("Berry", 135, "#9D174D", "#7C3AED"), g("Ember", 90, "#7F1D1D", "#EA580C", "#FBBF24"), g("Aurora", 135, "#0F766E", "#2563EB", "#7C3AED"),
  g("Lavender", 180, "#EDE9FE", "#FFFFFF"), g("Sand", 180, "#FEF3C7", "#FFFFFF"), g("Steel", 135, "#475569", "#94A3B8"), g("Candy", 90, "#F472B6", "#FDE047"),
];

export const SOLIDS = ["#FFFFFF", "#F8FAFC", "#F1F5F9", "#E2E8F0", "#0F172A", "#1E293B", "#FEF3C7", "#FFEDD5", "#FEE2E2", "#FCE7F3", "#EDE9FE", "#DBEAFE", "#CFFAFE", "#D1FAE5", "#ECFCCB", "#1D4ED8", "#166534", "#9D174D", "#5B21B6", "#C2410C", "#0F766E", "#7F1D1D"];

/** Text colour that stays readable on the given background colours: white, the dark default, or null when neither is safe. */
export function readableTextOn(colors: string[]): string | null {
  const hex = colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (hex.length !== colors.length || !hex.length) return null;
  const ok = (fg: string) => hex.every((c) => (contrastRatio(fg, c) ?? 0) >= 4.5);
  if (ok("#FFFFFF")) return "#FFFFFF";
  if (ok("#111827")) return "#111827";
  return null;
}
