import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, CreditsError, MemoryCredits, SupabaseCredits, costUsd, estimateCredits, runCharged, type CreditsStore } from "../src";

let k = 0;
const key = () => `req-${++k}-abcdefgh`;
const usage = { inputTokens: 1000, outputTokens: 500 };

describe("cost helpers", () => {
  it("credits per action; builds scale with pages and are clamped", () => {
    expect(estimateCredits("patch")).toBe(CREDIT_COSTS.patch);
    expect(estimateCredits("element")).toBe(2);
    expect(estimateCredits("layout")).toBe(3);
    expect(estimateCredits("build", 5)).toBe(10);
    expect(estimateCredits("build", 0)).toBe(2);
    expect(estimateCredits("build", 1000)).toBe(100);
    expect(estimateCredits("build", 2.6)).toBe(6);
  });
  it("converts tokens to dollars from a supplied price table (no prices are built in)", () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBe(3);
    expect(costUsd({ inputTokens: 500_000, outputTokens: 100_000 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBeCloseTo(3);
    expect(costUsd({ inputTokens: 0, outputTokens: 0 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBe(0);
  });
});

describe("MemoryCredits matches the SQL rules", () => {
  const store = (cap = 40) => { let t = Date.UTC(2025, 5, 1, 12); const c = new MemoryCredits(() => t, cap); return { c, advance: (ms: number) => (t += ms) }; };

  it("reserve holds credits, success charges, failure frees", async () => {
    const { c } = store();
    c.grant("u", 10);
    const a = await c.reserve("u", "layout", 3, key());
    expect(a).toMatchObject({ ok: true, available: 7 });
    if (!a.ok) return;
    await c.settle(a.jobId, { success: true, usage });
    expect(await c.available("u")).toBe(7);
    const b = await c.reserve("u", "patch", 1, key());
    if (!b.ok) throw new Error("x");
    await c.settle(b.jobId, { success: false, usage, errorKind: "invalid" });
    expect(await c.available("u")).toBe(7);
    expect(c.jobs.map((j) => [j.status, j.tokensIn])).toEqual([["succeeded", 1000], ["failed", 1000]]);
  });
  it("never overspends, and refusals leave nothing behind", async () => {
    const { c } = store();
    c.grant("u", 3);
    await c.reserve("u", "layout", 2, key());
    expect(await c.reserve("u", "layout", 2, key())).toMatchObject({ ok: false, reason: "insufficient_credits", available: 1 });
    expect(c.jobs).toHaveLength(1);
  });
  it("is idempotent per key and reports what happened to a repeated key", async () => {
    const { c } = store();
    c.grant("u", 10);
    const kk = key();
    const a = await c.reserve("u", "patch", 1, kk);
    expect(await c.reserve("u", "patch", 1, kk)).toMatchObject({ ok: false, reason: "in_progress" });
    if (!a.ok) return;
    await c.settle(a.jobId, { success: true, usage });
    expect(await c.reserve("u", "patch", 1, kk)).toMatchObject({ ok: false, reason: "already_done" });
    const kf = key();
    const f = await c.reserve("u", "patch", 1, kf);
    if (f.ok) await c.settle(f.jobId, { success: false, usage });
    expect(await c.reserve("u", "patch", 1, kf)).toMatchObject({ ok: false, reason: "key_reused" });
    expect(await c.available("u")).toBe(9);
  });
  it("settling twice or flipping a settled job changes nothing", async () => {
    const { c } = store();
    c.grant("u", 10);
    const a = await c.reserve("u", "element", 2, key());
    if (!a.ok) return;
    await c.settle(a.jobId, { success: true, usage });
    await c.settle(a.jobId, { success: true, usage });
    await c.settle(a.jobId, { success: false, usage });
    expect(await c.available("u")).toBe(8);
    await expect(c.settle("nope", { success: true, usage })).rejects.toThrow(CreditsError);
  });
  it("enforces the daily cap (reservations and successes count, failures do not) and it resets each day", async () => {
    const { c, advance } = store(5);
    c.grant("u", 1000);
    const a = await c.reserve("u", "layout", 3, key());
    expect(await c.reserve("u", "layout", 3, key())).toMatchObject({ ok: false, reason: "daily_cap" });
    if (a.ok) await c.settle(a.jobId, { success: false, usage });
    const b = await c.reserve("u", "layout", 3, key());
    if (b.ok) await c.settle(b.jobId, { success: true, usage });
    expect(await c.reserve("u", "patch", 3, key())).toMatchObject({ ok: false, reason: "daily_cap" });
    advance(24 * 3600_000);
    expect(await c.reserve("u", "patch", 3, key())).toMatchObject({ ok: true });
  });
  it("an abandoned reservation stops holding credits after 10 minutes", async () => {
    const { c, advance } = store();
    c.grant("u", 5);
    await c.reserve("u", "layout", 3, key());
    expect(await c.available("u")).toBe(2);
    advance(11 * 60_000);
    expect(await c.available("u")).toBe(5);
  });
  it("users are isolated, and invalid inputs are rejected", async () => {
    const { c } = store();
    c.grant("a", 5);
    expect(await c.available("b")).toBe(0);
    await expect(c.reserve("a", "patch", 0, key())).rejects.toThrow(CreditsError);
    await expect(c.reserve("a", "patch", 101, key())).rejects.toThrow(CreditsError);
    await expect(c.reserve("a", "patch", 1, "short")).rejects.toThrow(CreditsError);
    expect(() => c.grant("a", -1)).toThrow(CreditsError);
    expect(() => c.grant("a", 0)).toThrow(CreditsError);
  });
});

describe("runCharged", () => {
  const ok = { ok: true as const, usage };
  const bad = { ok: false as const, usage, reason: "invalid" };

  it("a successful run is charged exactly once", async () => {
    const c = new MemoryCredits();
    c.grant("u", 5);
    const r = await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run: async () => ok });
    expect(r).toMatchObject({ status: "done", charged: true });
    expect(await c.available("u")).toBe(4);
  });
  it("a failed run costs nothing but its tokens are still recorded", async () => {
    const c = new MemoryCredits();
    c.grant("u", 5);
    const r = await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), model: "m", run: async () => bad });
    expect(r).toMatchObject({ status: "done", charged: false });
    expect(await c.available("u")).toBe(5);
    expect(c.jobs[0]).toMatchObject({ status: "failed", tokensIn: 1000, tokensOut: 500, errorKind: "invalid", model: "m" });
  });
  it("provider failures are recorded under their kind", async () => {
    const c = new MemoryCredits();
    c.grant("u", 5);
    await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run: async () => ({ ok: false as const, providerKind: "rate_limited" }) });
    expect(c.jobs[0]!.errorKind).toBe("rate_limited");
  });
  it("refuses without calling the model when there are no credits, or the cap is hit, or the key was used", async () => {
    const c = new MemoryCredits(Date.now, 1);
    let ran = 0;
    const run = async () => (ran++, ok);
    expect(await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run })).toMatchObject({ status: "refused", reason: "insufficient_credits" });
    c.grant("u", 50);
    await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: "same-key-1", run });
    expect(await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: "same-key-1", run })).toMatchObject({ status: "refused", reason: "already_done" });
    expect(await runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run })).toMatchObject({ status: "refused", reason: "daily_cap" });
    expect(ran).toBe(1);
  });
  it("if the work throws, the reservation is released, nothing is charged, and the error propagates", async () => {
    const c = new MemoryCredits();
    c.grant("u", 5);
    await expect(runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run: async () => { throw new Error("boom"); } })).rejects.toThrow("boom");
    expect(await c.available("u")).toBe(5);
    expect(c.jobs[0]).toMatchObject({ status: "failed", errorKind: "exception" });
  });
  it("two parallel requests cannot both spend the last credit", async () => {
    const c = new MemoryCredits();
    c.grant("u", 1);
    const slow = async () => { await new Promise((r) => setTimeout(r, 10)); return ok; };
    const [a, b] = await Promise.all([
      runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run: slow }),
      runCharged({ store: c, user: "u", kind: "patch", credits: 1, key: key(), run: slow }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["done", "refused"]);
    expect(await c.available("u")).toBe(0);
  });
  it("if settling fails after a successful run, the result is still returned, flagged, and reported", async () => {
    const real = new MemoryCredits();
    real.grant("u", 5);
    const flaky: CreditsStore = { available: (u) => real.available(u), reserve: (...a) => real.reserve(...a), settle: async () => { throw new CreditsError(); } };
    const errors: unknown[] = [];
    const r = await runCharged({ store: flaky, user: "u", kind: "patch", credits: 1, key: key(), run: async () => ok, onSettleError: (e) => errors.push(e) });
    expect(r).toMatchObject({ status: "done", charged: false, settleFailed: true });
    expect(errors).toHaveLength(1);
  });
  it("retries settling once before giving up", async () => {
    const real = new MemoryCredits();
    real.grant("u", 5);
    let tries = 0;
    const once: CreditsStore = { available: (u) => real.available(u), reserve: (...a) => real.reserve(...a), settle: async (id, i) => { if (tries++ === 0) throw new CreditsError(); return real.settle(id, i); } };
    const r = await runCharged({ store: once, user: "u", kind: "patch", credits: 1, key: key(), run: async () => ok });
    expect(r).toMatchObject({ status: "done", charged: true });
    expect(await real.available("u")).toBe(4);
  });
});

describe("SupabaseCredits (against a scripted client)", () => {
  const client = (reply: (fn: string, args: Record<string, unknown>) => { data?: any; error?: { code?: string; message?: string } | null }) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    return { calls, rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: null, error: null, ...reply(fn, args) }; } };
  };
  it("reserve maps a fresh job, and the SQL error codes to refusals", async () => {
    const ok = client(() => ({ data: [{ job_id: "j1", status: "reserved", available: 7 }] }));
    expect(await new SupabaseCredits(ok).reserve("u", "layout", 3, "key-12345")).toEqual({ ok: true, jobId: "j1", available: 7 });
    expect(ok.calls[0]).toEqual({ fn: "ai_reserve", args: { p_user: "u", p_kind: "layout", p_credits: 3, p_key: "key-12345" } });
    expect(await new SupabaseCredits(client(() => ({ error: { code: "P0402" } }))).reserve("u", "layout", 3, "key-12345")).toMatchObject({ ok: false, reason: "insufficient_credits" });
    expect(await new SupabaseCredits(client(() => ({ error: { code: "P0429" } }))).reserve("u", "layout", 3, "key-12345")).toMatchObject({ ok: false, reason: "daily_cap" });
  });
  it("a replayed key that already finished is reported, not re-run", async () => {
    const done = client(() => ({ data: [{ job_id: "j1", status: "succeeded", available: 4 }] }));
    expect(await new SupabaseCredits(done).reserve("u", "patch", 1, "key-12345")).toMatchObject({ ok: false, reason: "already_done" });
    const failed = client(() => ({ data: [{ job_id: "j1", status: "failed", available: 4 }] }));
    expect(await new SupabaseCredits(failed).reserve("u", "patch", 1, "key-12345")).toMatchObject({ ok: false, reason: "key_reused" });
  });
  it("unexpected database errors and malformed replies become a safe CreditsError with no details", async () => {
    for (const reply of [() => ({ error: { code: "XX000", message: "relation secret_table missing" } }), () => ({ data: [] }), () => ({ data: [{ job_id: 5 }] })]) {
      const e = await new SupabaseCredits(client(reply)).reserve("u", "patch", 1, "key-12345").then(() => null, (x: Error) => x);
      expect(e).toBeInstanceOf(CreditsError);
      expect(e!.message).not.toContain("secret_table");
    }
  });
  it("settle sends the tokens and outcome; available validates the number", async () => {
    const c = client(() => ({}));
    await new SupabaseCredits(c).settle("j1", { success: false, usage, model: "m", errorKind: "invalid" });
    expect(c.calls[0]).toEqual({ fn: "ai_settle", args: { p_job: "j1", p_success: false, p_tokens_in: 1000, p_tokens_out: 500, p_model: "m", p_error: "invalid" } });
    await expect(new SupabaseCredits(client(() => ({ error: { code: "X" } }))).settle("j", { success: true, usage })).rejects.toThrow(CreditsError);
    expect(await new SupabaseCredits(client(() => ({ data: 12 }))).available("u")).toBe(12);
    await expect(new SupabaseCredits(client(() => ({ data: "12" }))).available("u")).rejects.toThrow(CreditsError);
  });
});
