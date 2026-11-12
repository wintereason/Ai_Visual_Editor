function lum(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG 2.1 contrast ratio, or null if either color isn't a 6-digit hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type Pair = { label: string; fg: string; bg: string };
export function failingPairs(colors: Record<string, string>): (Pair & { ratio: number })[] {
  const pairs: Pair[] = [
    { label: "Text on background", fg: colors.text!, bg: colors.background! },
    { label: "Text on surface", fg: colors.text!, bg: colors.surface! },
    { label: "Muted text on background", fg: colors.muted!, bg: colors.background! },
    { label: "Button text (white) on primary", fg: "#ffffff", bg: colors.primary! },
  ];
  return pairs.flatMap((p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    return ratio !== null && ratio < 4.5 ? [{ ...p, ratio }] : [];
  });
}
