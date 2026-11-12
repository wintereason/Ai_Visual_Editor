// Web Crypto is available in browsers and in Node 20+, so the same build code runs in the editor and on a server.

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** Base64 SHA-256 of text, in the form CSP expects: 'sha256-<this>'. */
export async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let s = "";
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s);
}
