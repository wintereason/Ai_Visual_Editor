import { contrastRatio, type Project } from "@avc/schema";
import type { AppIcon } from "@avc/publisher";
import { getAllAssets } from "./assets";

const SIZES = [192, 512] as const;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** The colour behind the icon: the app's theme colour, else the site's main colour. */
export function iconBackground(p: Project): string {
  const c = p.app?.themeColor ?? p.theme.colors.primary;
  return HEX6.test(c) ? c : "#2563eb";
}
/** The first letter shown on the automatic icon. */
export const iconLetter = (p: Project) => ((p.app?.shortName?.trim() || p.name.trim() || "A").match(/[\p{L}\p{N}]/u)?.[0] ?? "A").toUpperCase();
/** Which picture to use: the app icon if one was chosen, else the brand logo, else none (a letter is drawn instead). */
export const iconSourceId = (p: Project) => p.app?.iconAssetId ?? p.brand?.logoAssetId;

function canvas(size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  return c;
}
const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("no image"))), "image/png"));

/**
 * Draws one square app icon: a solid background (so it looks right on any phone home screen, including those that crop icons into circles),
 * with the picture or the letter kept inside the middle 64% (the area every platform guarantees to show).
 */
export async function drawAppIcon(p: Project, size: number, picture: Blob | null): Promise<HTMLCanvasElement> {
  const c = canvas(size);
  const g = c.getContext("2d")!;
  const bg = iconBackground(p);
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const inner = size * 0.64, off = (size - inner) / 2;
  let drawn = false;
  if (picture) {
    try {
      const bmp = await createImageBitmap(picture);
      const k = Math.min(inner / bmp.width, inner / bmp.height);
      const w = bmp.width * k, h = bmp.height * k;
      g.drawImage(bmp, off + (inner - w) / 2, off + (inner - h) / 2, w, h);
      bmp.close();
      drawn = true;
    } catch { /* an image the browser can't read: fall back to the letter */ }
  }
  if (!drawn) {
    g.fillStyle = (contrastRatio("#ffffff", bg) ?? 0) >= 3 ? "#ffffff" : "#111827";
    g.font = `700 ${Math.round(size * 0.5)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(iconLetter(p), size / 2, size / 2 + size * 0.03);
  }
  return c;
}

async function sourceBlob(p: Project): Promise<Blob | null> {
  const id = iconSourceId(p);
  if (!id) return null;
  return (await getAllAssets()).find((a) => a.asset.id === id)?.blob ?? null;
}

/** The two PNG icons the installable app needs (192 and 512 px). Never throws: without icons the build still works and says so. */
export async function makeAppIcons(p: Project): Promise<AppIcon[]> {
  try {
    const pic = await sourceBlob(p);
    const out: AppIcon[] = [];
    for (const size of SIZES) out.push({ size, bytes: await toPng(await drawAppIcon(p, size, pic)) });
    return out;
  } catch {
    return [];
  }
}

/** A small data-URL preview for the settings dialog. */
export async function previewAppIcon(p: Project): Promise<string> {
  const c = await drawAppIcon(p, 96, await sourceBlob(p));
  return c.toDataURL("image/png");
}
