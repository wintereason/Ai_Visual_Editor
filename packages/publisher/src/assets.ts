import { EXT_BY_KIND, MAX_UPLOAD_BYTES, MIME_BY_KIND, sniffImageType, type Asset } from "@avc/schema";
import { sha256Hex } from "./hash";

export type LibraryAsset = { asset: Asset; bytes: Uint8Array };

/** Public path of an asset inside the published site. Content-addressed, so it can be cached forever. */
export const publicAssetPath = (a: Asset) => `assets/${a.hash.slice(0, 12)}.${EXT_BY_KIND[a.kind]}`;

/**
 * Never trust upload-time metadata at publish time (spec 11.2 / 15.3). Re-check, from the actual bytes, that:
 *  - the size is within limits and matches what was recorded,
 *  - the content really is the image type it claims to be (magic bytes), not e.g. script or SVG with a .png name,
 *  - the SHA-256 matches the recorded hash (so the bytes are exactly what was uploaded and the public path is honest).
 * Returns human-readable problems; an empty list means the asset may be published.
 */
export async function verifyAsset({ asset, bytes }: LibraryAsset): Promise<string[]> {
  const problems: string[] = [];
  const name = `"${asset.name}"`;
  if (bytes.length === 0) return [`${name} is empty`];
  if (bytes.length > MAX_UPLOAD_BYTES) problems.push(`${name} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  if (bytes.length !== asset.bytes) problems.push(`${name} has ${bytes.length} bytes but ${asset.bytes} were recorded`);

  const sniffed = sniffImageType(bytes.subarray(0, 16));
  if (!sniffed) problems.push(`${name} is not a supported image (PNG, JPEG, GIF or WebP)`);
  else if (sniffed !== asset.kind) problems.push(`${name} is recorded as ${asset.kind} but its contents are ${sniffed}`);
  if (MIME_BY_KIND[asset.kind] !== asset.mime) problems.push(`${name} has a mismatched type label (${asset.mime})`);

  if ((await sha256Hex(bytes)) !== asset.hash) problems.push(`${name} does not match its recorded fingerprint, so it was changed after upload`);
  return problems;
}
