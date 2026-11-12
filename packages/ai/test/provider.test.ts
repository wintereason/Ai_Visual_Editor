import { describe, expect, it } from "vitest";
import { AnthropicProvider, ProviderError, ScriptedProvider, withRetry, type CompletionRequest } from "../src";

const REQ: CompletionRequest = { system: "SYS", messages: [{ role: "user", content: "hi" }], maxTokens: 100 };
const KEY = "sk-ant-SECRET-KEY-123";

const reply = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const ok = (extra: Record<string, unknown> = {}) =>
  reply(200, { model: "claude-x", content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", usage: { input_tokens: 11, output_tokens: 7 }, ...extra });
const provider = (f: typeof fetch, over: Record<string, unknown> = {}) => new AnthropicProvider({ apiKey: KEY, model: "claude-x", fetchImpl: f, ...over });
const kindOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: ProviderError) => e))!;

describe("AnthropicProvider: request", () => {
  it("posts to the Messages API with the key and version in headers, and the system prompt separate from messages", async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const p = provider(async (url, init) => { seen = { url: String(url), init }; return ok()(); });
    await p.complete({ ...REQ, temperature: 0.2 });
    expect(seen.url).toBe("https://api.anthropic.com/v1/messages");
    const h = seen.init!.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe(KEY);
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["content-type"]).toBe("application/json");
    const body = JSON.parse(String(seen.init!.body));
    expect(body).toEqual({ model: "claude-x", max_tokens: 100, temperature: 0.2, system: "SYS", messages: [{ role: "user", content: "hi" }] });
  });
  it("omits temperature when not set, and honours a custom base URL", async () => {
    let body: any; let url = "";
    await provider(async (u, init) => { url = String(u); body = JSON.parse(String(init!.body)); return ok()(); }, { baseUrl: "https://proxy.example.com" }).complete(REQ);
    expect("temperature" in body).toBe(false);
    expect(url).toBe("https://proxy.example.com/v1/messages");
  });
  it("refuses to be constructed without a key", () => {
    expect(() => new AnthropicProvider({ apiKey: "", model: "m" })).toThrow(ProviderError);
  });
});

describe("AnthropicProvider: response", () => {
  it("joins text blocks, ignores other block types, and reads usage and the stop reason", async () => {
    const r = await provider(ok({ content: [{ type: "text", text: "A" }, { type: "tool_use", id: "x" }, { type: "text", text: "B" }] })).complete(REQ);
    expect(r).toEqual({ text: "AB", model: "claude-x", stop: "end", usage: { inputTokens: 11, outputTokens: 7 } });
  });
  it("maps max_tokens to 'length' so callers know the output was cut off", async () => {
    expect((await provider(ok({ stop_reason: "max_tokens" })).complete(REQ)).stop).toBe("length");
  });
  it("falls back to estimates when usage is missing or garbage", async () => {
    const r = await provider(ok({ usage: { input_tokens: "lots", output_tokens: null } })).complete(REQ);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });
  it("a refusal is its own error kind, not an empty success", async () => {
    const e = await kindOf(provider(ok({ stop_reason: "refusal" })).complete(REQ));
    expect(e).toMatchObject({ kind: "refused", retryable: false });
  });
  it("rejects malformed bodies", async () => {
    expect((await kindOf(provider(reply(200, "not json")).complete(REQ))).kind).toBe("invalid_response");
    expect((await kindOf(provider(reply(200, { content: "nope" })).complete(REQ))).kind).toBe("invalid_response");
    expect((await kindOf(provider(reply(200, {})).complete(REQ))).kind).toBe("invalid_response");
  });
});

describe("AnthropicProvider: errors are classified and never leak secrets", () => {
  const cases: [number, string, boolean][] = [[401, "auth", false], [403, "auth", false], [429, "rate_limited", true], [500, "overloaded", true], [503, "overloaded", true], [529, "overloaded", true], [400, "bad_request", false], [404, "bad_request", false], [422, "bad_request", false]];
  for (const [status, kind, retryable] of cases) {
    it(`HTTP ${status} -> ${kind}${retryable ? " (retryable)" : ""}`, async () => {
      const e = await kindOf(provider(reply(status, { error: { message: `leaky: key ${KEY} and the user's prompt text` } })).complete(REQ));
      expect(e).toBeInstanceOf(ProviderError);
      expect(e).toMatchObject({ kind, retryable });
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("leaky");
      expect(e.message).not.toContain("prompt text");
    });
  }
  it("a network failure is retryable and does not expose the underlying message", async () => {
    const e = await kindOf(provider(async () => { throw new TypeError(`fetch failed for key ${KEY}`); }).complete(REQ));
    expect(e).toMatchObject({ kind: "network", retryable: true });
    expect(e.message).not.toContain(KEY);
  });
  it("a slow service times out as a retryable error", async () => {
    const slow: typeof fetch = (_u, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const e = await kindOf(provider(slow, { timeoutMs: 20 }).complete(REQ));
    expect(e).toMatchObject({ kind: "timeout", retryable: true });
  });
  it("the key is only ever sent in the header, never in the body", async () => {
    let body = "";
    await provider(async (_u, init) => { body = String(init!.body); return ok()(); }).complete(REQ);
    expect(body).not.toContain(KEY);
  });
});

describe("withRetry", () => {
  const flaky = (failures: ProviderError[]) => {
    const p = new ScriptedProvider((_r, call) => failures[call] ?? "done");
    return p;
  };
  const delays: number[] = [];
  const sleep = async (ms: number) => void delays.push(ms);

  it("retries transient failures with exponential backoff, then succeeds", async () => {
    delays.length = 0;
    const inner = flaky([new ProviderError("rate_limited", "x", true), new ProviderError("overloaded", "x", true)]);
    const r = await withRetry(inner, { attempts: 3, baseDelayMs: 100, sleep }).complete(REQ);
    expect(r.text).toBe("done");
    expect(inner.calls).toBe(3);
    expect(delays).toEqual([100, 200]);
  });
  it("gives up after the configured attempts and throws the last error", async () => {
    const inner = flaky(Array.from({ length: 5 }, () => new ProviderError("overloaded", "busy", true)));
    const e = await kindOf(withRetry(inner, { attempts: 3, sleep }).complete(REQ));
    expect(e.kind).toBe("overloaded");
    expect(inner.calls).toBe(3);
  });
  it("never retries non-retryable errors (auth, bad request, refusal), and never retries unknown errors", async () => {
    for (const kind of ["auth", "bad_request", "refused"] as const) {
      const inner = flaky([new ProviderError(kind, "no", false)]);
      await kindOf(withRetry(inner, { sleep }).complete(REQ));
      expect(inner.calls, kind).toBe(1);
    }
    let calls = 0;
    const boom: any = { name: "x", complete: async () => { calls++; throw new Error("unexpected"); } };
    await expect(withRetry(boom, { sleep }).complete(REQ)).rejects.toThrow("unexpected");
    expect(calls).toBe(1);
  });
  it("stops retrying once the caller has cancelled", async () => {
    const ctl = new AbortController();
    const inner = flaky(Array.from({ length: 5 }, () => new ProviderError("network", "x", true)));
    const p = withRetry(inner, { attempts: 5, sleep: async () => ctl.abort() });
    await kindOf(p.complete({ ...REQ, signal: ctl.signal }));
    expect(inner.calls).toBe(2);
  });
});

describe("ScriptedProvider", () => {
  it("replays steps in order, repeats the last, records requests and reports usage", async () => {
    const p = new ScriptedProvider(["one", "two"]);
    expect((await p.complete(REQ)).text).toBe("one");
    expect((await p.complete(REQ)).text).toBe("two");
    const third = await p.complete(REQ);
    expect(third.text).toBe("two");
    expect(third.usage.outputTokens).toBeGreaterThan(0);
    expect(p.requests).toHaveLength(3);
  });
  it("can throw provider errors and compute replies from the request", async () => {
    const p = new ScriptedProvider([new ProviderError("auth", "nope"), (req) => `echo:${req.messages[0]!.content}`]);
    await expect(p.complete(REQ)).rejects.toThrow("nope");
    expect((await p.complete(REQ)).text).toBe("echo:hi");
  });
});
