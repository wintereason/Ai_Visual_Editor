export type PreparedImage = { mediaType: "image/jpeg"; data: string; preview: string; width: number; height: number };
export class StyleImageError extends Error {}

const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_INPUT_BYTES = 15 * 1024 * 1024; // what we're willing to open at all
const MAX_EDGE = 1024; // longest side sent to the model: plenty to judge a style, and much cheaper and faster than a full-size photo

/**
 * Turns a picked file into a small JPEG for the style request. Re-drawing on a canvas also drops the file's hidden metadata
 * (camera, location, author), so only the pixels leave the browser. Throws StyleImageError with a message safe to show.
 */
export async function prepareStyleImage(file: File): Promise<PreparedImage> {
  if (!ACCEPT.includes(file.type)) throw new StyleImageError("Choose a PNG, JPEG, WebP or GIF picture.");
  if (file.size > MAX_INPUT_BYTES) throw new StyleImageError("That picture is too large. Use one under 15 MB.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new StyleImageError("That picture couldn't be opened. Try a different one."); }
  try {
    if (bitmap.width < 16 || bitmap.height < 16) throw new StyleImageError("That picture is too small to judge a style from.");
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new StyleImageError("Your browser couldn't prepare the picture.");
    ctx.fillStyle = "#ffffff"; // transparent areas become white rather than black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    const data = url.slice(url.indexOf(",") + 1);
    return { mediaType: "image/jpeg", data, preview: url, width: w, height: h };
  } finally {
    bitmap.close();
  }
}
