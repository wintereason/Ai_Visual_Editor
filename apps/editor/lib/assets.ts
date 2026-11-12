import { EXT_BY_KIND, fitWithin, MAX_UPLOAD_BYTES, MIME_BY_KIND, sniffImageType, type Asset, type CropRect, type ImageKind } from "@avc/schema";

// Storage sits behind this small interface so a cloud backend (signed-URL uploads, spec 11.2) can replace IndexedDB later.
export type StoredAsset = { asset: Asset; blob: Blob };

const DB = "avc-assets";
const STORE = "assets";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "asset.id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = run(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export const putAsset = (a: StoredAsset) => tx("readwrite", (s) => s.put(a));
export const deleteAsset = (id: string) => tx("readwrite", (s) => s.delete(id));
export const getAllAssets = () => tx<StoredAsset[]>("readonly", (s) => s.getAll());
export const getAsset = (id: string) => tx<StoredAsset | undefined>("readonly", (s) => s.get(id));

export class UploadError extends Error {}

const sha256 = async (b: Blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, "0")).join("");

// Derived from the content hash, so the same image uploaded on two devices is the same asset (no duplicate rows, no remapping).
const assetIdFor = (hash: string) => `asset_${hash.slice(0, 24)}`;

/**
 * Spec 11.2 upload flow, client side:
 *  - size cap, then type by magic bytes (name and declared MIME are ignored; SVG is not accepted yet)
 *  - still images are redrawn onto a canvas and re-encoded: this strips EXIF/GPS and downsizes to MAX_DIMENSION
 *  - GIFs are kept as-is (re-encoding would drop the animation); GIFs carry no EXIF
 *  - sha256 of the stored bytes is returned for de-duplication
 */
export async function processUpload(file: File): Promise<StoredAsset> {
  if (file.size === 0) throw new UploadError(`${file.name}: the file is empty`);
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`${file.name}: larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (!sniffed) throw new UploadError(`${file.name}: not a supported image (use PNG, JPEG, WebP or GIF)`);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UploadError(`${file.name}: the image could not be read; it may be corrupt`);
  }

  let blob: Blob = file;
  let kind: ImageKind = sniffed;
  let { width, height } = bitmap;
  if (sniffed !== "gif") {
    const fit = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, fit.width, fit.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
    if (out && out.type === "image/webp") {
      blob = out;
      kind = "webp";
    } else {
      blob = (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")))!;
      kind = "png";
    }
    width = fit.width;
    height = fit.height;
  }
  bitmap.close();

  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "image";
  const hash = await sha256(blob);
  const asset: Asset = {
    id: assetIdFor(hash), name, kind, mime: MIME_BY_KIND[kind], bytes: blob.size, width, height,
    hash, createdAt: Date.now(),
  };
  return { asset, blob: blob.type === asset.mime ? blob : new Blob([blob], { type: asset.mime }) };
}

export const assetFileName = (a: Asset) => `${a.hash.slice(0, 12)}.${EXT_BY_KIND[a.kind]}`;

export type TransformOp = { rotate: 90 | 180 | 270 } | { crop: CropRect };

/**
 * Produce a NEW library file from `source` (rotate or crop). The original is never modified, so edits are reversible
 * (spec 11.2 "non-destructive"): the image node simply points at the derived file, and can point back.
 * Re-encoded as WebP like every upload, which also keeps EXIF out.
 */
export async function deriveImage(source: StoredAsset, op: TransformOp): Promise<StoredAsset> {
  if (source.asset.kind === "gif") throw new UploadError("Animated GIFs can't be rotated or cropped.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source.blob);
  } catch {
    throw new UploadError("That image could not be read.");
  }
  const bw = bitmap.width;
  const bh = bitmap.height;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  if ("rotate" in op) {
    const quarter = op.rotate === 90 || op.rotate === 270;
    canvas.width = quarter ? bh : bw;
    canvas.height = quarter ? bw : bh;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((op.rotate * Math.PI) / 180);
    ctx.drawImage(bitmap, -bw / 2, -bh / 2);
  } else {
    const sx = Math.round(op.crop.x * bw);
    const sy = Math.round(op.crop.y * bh);
    const sw = Math.max(1, Math.min(bw - sx, Math.round(op.crop.w * bw)));
    const sh = Math.max(1, Math.min(bh - sy, Math.round(op.crop.h * bh)));
    const fit = fitWithin(sw, sh);
    canvas.width = fit.width;
    canvas.height = fit.height;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, fit.width, fit.height);
  }
  bitmap.close();

  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
  const isWebp = !!out && out.type === "image/webp";
  const blob = isWebp ? out : (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")))!;
  const kind: ImageKind = isWebp ? "webp" : "png";
  const hash = await sha256(blob);
  const label = "rotate" in op ? "rotated" : "cropped";
  const asset: Asset = {
    id: assetIdFor(hash), name: `${source.asset.name} (${label})`.slice(0, 120), kind, mime: MIME_BY_KIND[kind], bytes: blob.size,
    width: canvas.width, height: canvas.height, hash, createdAt: Date.now(),
    ...(source.asset.alt ? { alt: source.asset.alt } : {}),
    derivedFrom: { assetId: source.asset.id, op: "rotate" in op ? "rotate" : "crop" },
  };
  return { asset, blob: blob.type === asset.mime ? blob : new Blob([blob], { type: asset.mime }) };
}
