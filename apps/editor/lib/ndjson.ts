/**
 * Reads a newline-delimited JSON response: every "progress" line goes to `onProgress`, and the last "result" line is returned.
 * Throws if the stream ends without a result (the connection dropped). Garbled lines are ignored.
 */
export async function readNdjson(res: Response, onProgress?: (m: Record<string, any>) => void, signal?: AbortSignal): Promise<{ status: number; body: any }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no stream");
  const dec = new TextDecoder();
  let buf = "";
  let result: { status: number; body: any } | null = null;
  const handle = (text: string) => {
    if (!text.trim()) return;
    let m: any;
    try { m = JSON.parse(text); } catch { return; }
    if (m?.type === "progress") { try { onProgress?.(m); } catch { /* listener bug */ } }
    else if (m?.type === "result" && typeof m.status === "number") result = { status: m.status, body: m.body };
  };
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    buf += dec.decode();
    handle(buf);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (!result) throw new Error("stream ended without a result");
  return result;
}
