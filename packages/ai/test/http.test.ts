import { describe, expect, it } from "vitest";
import { exampleProject } from "@avc/schema";
import { TEMPLATES } from "@avc/templates";
import { createRateLimiter, handleAiRequest, MemoryCredits, MAX_BODY_BYTES, ProviderError, ScriptedProvider, type AiDeps, type AiKind, type CreditsStore } from "../src";

const USER = "user-1";
let seq = 0;
const newId = () => `s${++seq}`;
const setHeadline = (t: string) => JSON.stringify({ summary: "Changed the headline", ops: [{ op: "update", id: "hero1", props: { headline: t } }] });

type SetupOpts = Partial<AiDeps> & { script?: ConstructorParameters<typeof ScriptedProvider>[0]; balance?: number; store?: MemoryCredits };
function setup(opts: SetupOpts = {}) {
  const { script, balance, store: given, ...over } = opts; // test-only options never leak into the deps
  const store = given ?? new MemoryCredits();
  if (!given && balance !== 0) store.grant(USER, balance ?? 20);
  const provider = new ScriptedProvider(script ?? [setHeadline("Hello there")]);
  const logs: Record<string, unknown>[] = [];
  const deps: AiDeps = { provider, credits: store, authenticate: async (r) => (r.headers.get("authorization") === "Bearer good" ? USER : null), newId, log: (e) => logs.push(e), ...over };
  return { deps, store, provider, logs };
}
const patchBody = (over: Record<string, unknown> = {}) => ({ project: exampleProject, nodeId: "hero1", instruction: "make it friendlier", ...over });
const call = (kind: AiKind, deps: AiDeps, body: unknown, init: RequestInit & { raw?: string } = {}) =>
  handleAiRequest(kind, new Request("http://x/api/ai/" + kind, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer good", ...(init.headers as Record<string, string>) }, body: init.raw ?? JSON.stringify(body), ...(init.method ? { method: init.method } : {}) }), deps);
const read = async (r: Response) => ({ status: r.status, body: await r.json() as any, headers: r.headers });

describe("gatekeeping happens before anything costs money", () => {
  it("only POST is allowed", async () => {
    const { deps } = setup();
    const r = await handleAiRequest("patch", new Request("http://x", { method: "GET" }), deps);
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("POST");
  });
  it("says so plainly when AI is not configured, without revealing anything", async () => {
    const { deps } = setup({ provider: null });
    const { status, body } = await read(await call("patch", deps, patchBody()));
    expect(status).toBe(503);
    expect(body.code).toBe("not_configured");
  });
  it("401 without a valid credential, including when the authenticator throws", async () => {
    const { deps, provider } = setup();
    expect((await call("patch", deps, patchBody(), { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call("patch", deps, patchBody(), { headers: { authorization: "" } })).status).toBe(401);
    const boom = setup({ authenticate: async () => { throw new Error("db down with secret"); } });
    const r = await read(await call("patch", boom.deps, patchBody()));
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toContain("secret");
    expect(provider.calls).toBe(0);
  });
  it("a user id in the body is not accepted (the server decides who you are)", async () => {
    const { deps, provider } = setup();
    const r = await read(await call("patch", deps, patchBody({ userId: "someone-else" })));
    expect(r.status).toBe(400);
    expect(provider.calls).toBe(0);
  });
  it("rate limits per user with a Retry-After header, and never calls the model", async () => {
    const allow = createRateLimiter({ max: 2, windowMs: 60_000 });
    const { deps, provider } = setup({ allow, script: [setHeadline("a"), setHeadline("b"), setHeadline("c")] });
    expect((await call("patch", deps, patchBody())).status).toBe(200);
    expect((await call("patch", deps, patchBody())).status).toBe(200);
    const third = await call("patch", deps, patchBody());
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("30");
    expect(provider.calls).toBe(2);
  });
  it("rejects non-JSON, oversized, unreadable and invalid bodies", async () => {
    const { deps, store, provider } = setup();
    expect((await call("patch", deps, null, { headers: { "content-type": "text/plain" }, raw: "hi" })).status).toBe(415);
    expect((await call("patch", deps, null, { raw: "{not json" })).status).toBe(400);
    expect((await call("patch", deps, null, { raw: "x".repeat(MAX_BODY_BYTES + 1) })).status).toBe(413);
    expect((await call("patch", deps, null, { headers: { "content-length": String(MAX_BODY_BYTES + 1) }, raw: "{}" })).status).toBe(413);
    for (const bad of [patchBody({ instruction: "" }), patchBody({ nodeId: "" }), patchBody({ instruction: "x".repeat(4001) }), patchBody({ extra: 1 }), patchBody({ idempotencyKey: "short" }), "[]", null, 5]) {
      expect((await call("patch", deps, bad)).status, JSON.stringify(bad)?.slice(0, 40)).toBe(400);
    }
    expect(provider.calls).toBe(0);
    expect(await store.available(USER)).toBe(20); // nothing was reserved by any of the above
  });
  it("an invalid project is rejected with a generic message and never reaches the model", async () => {
    const { deps, provider } = setup();
    const bad = structuredClone(exampleProject);
    (bad.pages[0]!.nodes[1]!.children![0]!.props as Record<string, unknown>).ctaHref = "javascript:alert(1)";
    const r = await read(await call("patch", deps, patchBody({ project: bad })));
    expect(r).toMatchObject({ status: 400, body: { code: "invalid_project" } });
    expect(JSON.stringify(r.body)).not.toContain("javascript");
    expect(provider.calls).toBe(0);
  });
});

describe("patch: success", () => {
  it("returns the patch (not the project), charges one credit, and is never cached", async () => {
    const { deps, store } = setup();
    const r = await read(await call("patch", deps, patchBody()));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, summary: "Changed the headline", touched: ["hero1"], attempts: 1, credits: { charged: true, cost: 1 } });
    expect(r.body.patch.ops[0]).toMatchObject({ op: "update", id: "hero1" });
    expect("project" in r.body).toBe(false);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await store.available(USER)).toBe(19);
  });
  it("logs job metadata but never the user's text or the project", async () => {
    const { deps, logs } = setup();
    await call("patch", deps, patchBody({ instruction: "PRIVATE-INSTRUCTION-TEXT" }));
    expect(logs.length).toBeGreaterThan(0);
    const all = JSON.stringify(logs);
    expect(all).toContain("ai_job");
    expect(all).not.toContain("PRIVATE-INSTRUCTION-TEXT");
    expect(all).not.toContain("Learn skills");
  });
});

describe("patch: failures are never charged and never leak", () => {
  it("an answer that never validates returns 422 and costs nothing, but the tokens are recorded", async () => {
    const { deps, store } = setup({ script: ["nonsense"] });
    const r = await read(await call("patch", deps, patchBody()));
    expect(r).toMatchObject({ status: 422, body: { ok: false, code: "invalid", credits: { charged: false, cost: 0 } } });
    expect(await store.available(USER)).toBe(20);
    expect(store.jobs[0]).toMatchObject({ status: "failed" });
    expect(store.jobs[0]!.tokensIn).toBeGreaterThan(0);
  });
  const providerCases: [string, number][] = [["rate_limited", 429], ["overloaded", 503], ["network", 503], ["timeout", 503], ["refused", 422], ["auth", 503], ["bad_request", 503], ["invalid_response", 503]];
  for (const [kind, status] of providerCases) {
    it(`provider failure '${kind}' -> ${status}, not charged, and no provider or key text reaches the client`, async () => {
      const { deps, store } = setup({ script: [new ProviderError(kind as never, `LEAK sk-ant-SECRET ${kind} stack trace at provider.ts:12`, true)] });
      const r = await read(await call("patch", deps, patchBody()));
      expect(r.status).toBe(status);
      const text = JSON.stringify(r.body);
      for (const leak of ["LEAK", "sk-ant", "SECRET", "stack", "provider.ts"]) expect(text, leak).not.toContain(leak);
      if (kind === "auth" || kind === "bad_request") expect(r.body.message).not.toMatch(/key|auth|credential/i);
      expect(await store.available(USER)).toBe(20);
    });
  }
  it("an unexpected exception inside the provider call becomes a generic error, and the reservation is released", async () => {
    const { deps, store } = setup({ script: () => { throw new Error("internal bug with secret"); } });
    const r = await read(await call("patch", deps, patchBody()));
    expect(r).toMatchObject({ status: 503, body: { ok: false, credits: { charged: false } } });
    expect(JSON.stringify(r.body)).not.toContain("secret");
    expect(await store.available(USER)).toBe(20);
  });
  it("if credits infrastructure is down the user gets a generic error and the model is not called", async () => {
    const broken: CreditsStore = { available: async () => { throw new Error("db password leaked"); }, reserve: async () => { throw new Error("db password leaked"); }, settle: async () => {} };
    const { deps, provider } = setup();
    const r = await read(await call("patch", { ...deps, credits: broken }, patchBody()));
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("password");
    expect(provider.calls).toBe(0);
  });
  it("if charging fails AFTER a good answer, the user still gets the answer, flagged", async () => {
    const real = new MemoryCredits(); real.grant(USER, 5);
    const flaky: CreditsStore = { available: (u) => real.available(u), reserve: (...a) => real.reserve(...a), settle: async () => { throw new Error("db down"); } };
    const { deps } = setup();
    const r = await read(await call("patch", { ...deps, credits: flaky }, patchBody()));
    expect(r).toMatchObject({ status: 200, body: { ok: true, credits: { charged: false, settleFailed: true } } });
  });
});

describe("credits and idempotency", () => {
  it("402 with the remaining balance when out of credits; the model is not called", async () => {
    const { deps, provider } = setup({ balance: 0 });
    const r = await read(await call("patch", deps, patchBody()));
    expect(r).toMatchObject({ status: 402, body: { code: "insufficient_credits", available: 0 } });
    expect(provider.calls).toBe(0);
  });
  it("429 at the daily cap", async () => {
    const store = new MemoryCredits(Date.now, 1);
    store.grant(USER, 50);
    const { deps } = setup({ store, script: [setHeadline("a"), setHeadline("b")] });
    expect((await call("patch", deps, patchBody())).status).toBe(200);
    expect(await read(await call("patch", deps, patchBody()))).toMatchObject({ status: 429, body: { code: "daily_cap" } });
  });
  it("the same idempotency key is charged and run once; the replay is told it already finished", async () => {
    const { deps, store, provider } = setup({ script: [setHeadline("a"), setHeadline("b")] });
    const body = patchBody({ idempotencyKey: "user-action-0001" });
    expect((await call("patch", deps, body)).status).toBe(200);
    const again = await read(await call("patch", deps, body));
    expect(again).toMatchObject({ status: 409, body: { code: "already_done" } });
    expect(provider.calls).toBe(1);
    expect(await store.available(USER)).toBe(19);
  });
  it("a double-click while the first is running is refused, not run twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = new ScriptedProvider([setHeadline("x")]);
    const wrapped = { name: "slow", complete: async (req: Parameters<ScriptedProvider["complete"]>[0]) => { await gate; return inner.complete(req); } };
    const { deps, store } = setup({ provider: wrapped as never });
    const body = patchBody({ idempotencyKey: "double-click-001" });
    const first = call("patch", deps, body);
    await new Promise((r) => setTimeout(r, 10));
    const second = await read(await call("patch", deps, body));
    expect(second).toMatchObject({ status: 409, body: { code: "in_progress" } });
    release();
    expect((await first).status).toBe(200);
    expect(await store.available(USER)).toBe(19);
  });
  it("a failed attempt's key cannot be reused to dodge the accounting, but a new key works", async () => {
    // three bad answers use up the first request's retries; the 4th scripted answer is for the second request
    const { deps } = setup({ script: ["nonsense", "nonsense", "nonsense", setHeadline("ok")] });
    const body = patchBody({ idempotencyKey: "first-try-0001" });
    expect((await call("patch", deps, body)).status).toBe(422);
    expect(await read(await call("patch", deps, body))).toMatchObject({ status: 409, body: { code: "key_reused" } });
    expect((await call("patch", deps, { ...body, idempotencyKey: "second-try-001" })).status).toBe(200);
  });
});

describe("the other agents", () => {
  const elementOk = JSON.stringify({ options: [{ name: "A", tree: { id: "a", kind: "element", type: "text", props: { text: "x" } } }] });
  const goodTheme = TEMPLATES[0]!.make().theme;
  const layoutOk = JSON.stringify({ name: "S", theme: goodTheme, pages: [{ name: "Home", path: "/", seo: { title: "H" }, nodes: [{ id: "n", kind: "container", type: "section", props: {}, children: [{ id: "h", kind: "block", type: "hero", variant: "centered", props: { headline: "Hi" } }] }] }] });

  it("element: returns options and charges 2", async () => {
    const { deps, store } = setup({ script: [elementOk] });
    const r = await read(await call("element", deps, { theme: goodTheme, prompt: "a pricing card" }));
    expect(r).toMatchObject({ status: 200, body: { ok: true, credits: { cost: 2 } } });
    expect(r.body.options).toHaveLength(1);
    expect(await store.available(USER)).toBe(18);
  });
  it("element: rejects an invalid theme before spending", async () => {
    const { deps, provider } = setup({ script: [elementOk] });
    expect((await call("element", deps, { theme: { colors: "red" }, prompt: "x" })).status).toBe(400);
    expect(provider.calls).toBe(0);
  });
  it("layout: returns a whole project and charges 3", async () => {
    const { deps, store } = setup({ script: [layoutOk] });
    const r = await read(await call("layout", deps, { brief: { prompt: "a coaching site", pages: ["Home"], style: "bold", language: "Hindi" } }));
    expect(r).toMatchObject({ status: 200, body: { ok: true, credits: { cost: 3 } } });
    expect(r.body.project.pages[0].path).toBe("/");
    expect(await store.available(USER)).toBe(17);
  });
  it("layout: validates the brief shape (unknown style, too many pages)", async () => {
    const { deps, provider } = setup({ script: [layoutOk] });
    expect((await call("layout", deps, { brief: { prompt: "x", style: "gothic" } })).status).toBe(400);
    expect((await call("layout", deps, { brief: { prompt: "x", pages: Array.from({ length: 13 }, () => "p") } })).status).toBe(400);
    expect(provider.calls).toBe(0);
  });
  it("build_page: returns one page's nodes with the structure intact, charging 2 per page", async () => {
    const approved = TEMPLATES.find((t) => t.id === "school")!.make();
    const nodes = approved.pages[0]!.nodes;
    const { deps, store } = setup({ script: [JSON.stringify({ nodes })] });
    const r = await read(await call("build_page", deps, { project: approved, pageId: approved.pages[0]!.id, brief: { prompt: "a school" } }));
    expect(r).toMatchObject({ status: 200, body: { ok: true, credits: { cost: 2 } } });
    expect(r.body.page.id).toBe(approved.pages[0]!.id);
    expect(await store.available(USER)).toBe(18);
  });
  it("build_page: a structure violation is a free 422", async () => {
    const approved = TEMPLATES.find((t) => t.id === "school")!.make();
    const { deps, store } = setup({ script: [JSON.stringify({ nodes: [...approved.pages[0]!.nodes].reverse() })] });
    const r = await read(await call("build_page", deps, { project: approved, pageId: approved.pages[0]!.id, brief: { prompt: "x" } }));
    expect(r.status).toBe(422);
    expect(await store.available(USER)).toBe(20);
  });
});

describe("createRateLimiter", () => {
  it("allows up to max per window per key, then recovers as the window slides", () => {
    let t = 0;
    const allow = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect([allow("a"), allow("a"), allow("a"), allow("a")]).toEqual([true, true, true, false]);
    expect(allow("b")).toBe(true); // other users are unaffected
    t = 1001;
    expect(allow("a")).toBe(true);
  });
});
