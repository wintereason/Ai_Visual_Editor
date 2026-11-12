import type { Node, Project } from "./types";

export type ImageKind = "png" | "jpeg" | "gif" | "webp";

export type Asset = {
  id: string;
  name: string;
  kind: ImageKind;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  /** sha256 hex of the stored bytes; used to de-duplicate uploads. */
  hash: string;
  alt?: string;
  createdAt: number;
  /** Set when this file was produced from another library file (rotate / crop). The original is kept. */
  derivedFrom?: { assetId: string; op: "rotate" | "crop" };
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_DIMENSION = 2400;

export const MIME_BY_KIND: Record<ImageKind, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const EXT_BY_KIND: Record<ImageKind, string> = { png: "png", jpeg: "jpg", gif: "gif", webp: "webp" };

/** Identify an image by its leading bytes. The file name and declared MIME type are never trusted. */
export function sniffImageType(b: Uint8Array): ImageKind | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 && (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61) return "gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "webp";
  return null;
}

/** Scale (w, h) down to fit within `max` on the longest side; never upscales. */
export function fitWithin(w: number, h: number, max = MAX_DIMENSION): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export type CropRect = { x: number; y: number; w: number; h: number };
export const CROP_ASPECTS = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16 } as const;
export type CropAspect = keyof typeof CROP_ASPECTS;

/**
 * The largest rectangle of aspect ratio `aspect` that fits inside a `srcW` x `srcH` image, as fractions (0..1) of the
 * source. `px` / `py` (0..1) say where the rectangle sits in the free space (0 = top/left edge, 1 = bottom/right edge).
 * Out-of-range positions are clamped; the rectangle always stays inside the image.
 */
export function cropRect(srcW: number, srcH: number, aspect: number, px = 0.5, py = 0.5): CropRect {
  if (!(srcW > 0) || !(srcH > 0) || !(aspect > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  const srcAspect = srcW / srcH;
  const w = srcAspect > aspect ? (aspect * srcH) / srcW : 1;
  const h = srcAspect > aspect ? 1 : srcW / (aspect * srcH);
  return { x: (1 - w) * clamp(px), y: (1 - h) * clamp(py), w, h };
}

function* walk(nodes: Node[]): Generator<Node> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walk(n.children);
  }
}

const ASSET_KEYS = new Set(["assetId", "imageAssetId"]);

/** Asset ids referenced by one node: any depth inside props (gallery images, team photos, logos), plus background styles. */
export function collectNodeAssetIds(n: Node): Set<string> {
  const ids = new Set<string>();
  const scan = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => scan(x, depth + 1));
    for (const [k, val] of Object.entries(v)) {
      if (ASSET_KEYS.has(k) && typeof val === "string") ids.add(val);
      else scan(val, depth + 1);
    }
  };
  scan(n.props, 0);
  for (const bp of Object.values(n.styles ?? {}))
    for (const st of Object.values(bp ?? {})) {
      const bg = (st as { background?: unknown } | undefined)?.background;
      if (bg && typeof bg === "object" && "assetId" in bg) ids.add((bg as { assetId: string }).assetId);
    }
  return ids;
}

/** Every asset id a project references: image/video props, hero images, block arrays and background styles. */
export function collectAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const page of project.pages) for (const n of walk(page.nodes)) for (const id of collectNodeAssetIds(n)) ids.add(id);
  return ids;
}

/** Files the editor should protect from deletion: everything published, plus the brand kit's logo (which is not published until it is placed on a page). */
export function collectKeptAssetIds(project: Project): Set<string> {
  const ids = collectAssetIds(project);
  if (project.brand?.logoAssetId) ids.add(project.brand.logoAssetId);
  if (project.app?.iconAssetId) ids.add(project.app.iconAssetId);
  return ids;
}
