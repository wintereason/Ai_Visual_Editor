import type { Usage } from "./provider";

export type JobKind = "patch" | "element" | "layout" | "build";

/** Credits per action (a product decision, adjustable). Failures are never charged. */
export const CREDIT_COSTS = { patch: 1, element: 2, layout: 3, buildPerPage: 2 } as const;

export function estimateCredits(kind: JobKind, pages = 1): number {
  switch (kind) {
    case "patch": return CREDIT_COSTS.patch;
    case "element": return CREDIT_COSTS.element;
    case "layout": return CREDIT_COSTS.layout;
    case "build": return Math.max(1, Math.min(50, Math.round(pages))) * CREDIT_COSTS.buildPerPage;
  }
}

/** Provider prices per million tokens. Supplied by configuration from the provider's current pricing page; never guessed here. */
export type PriceTable = { inputPerMTok: number; outputPerMTok: number };
export function costUsd(usage: Usage, price: PriceTable): number {
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
}

export type ReserveRefusal = "insufficient_credits" | "daily_cap" | "in_progress" | "already_done" | "key_reused";
export type Reservation = { ok: true; jobId: string; available: number } | { ok: false; reason: ReserveRefusal; available?: number };
export type SettleInfo = { success: boolean; usage: Usage; model?: string; errorKind?: string };

export class CreditsError extends Error {
  constructor(message = "Credits are temporarily unavailable. Please try again.") {
    super(message);
    this.name = "CreditsError";
  }
}

export interface CreditsStore {
  available(user: string): Promise<number>;
  /** Idempotent per (user, key). Refuses rather than overspending. */
  reserve(user: string, kind: JobKind, credits: number, key: string): Promise<Reservation>;
  /** Idempotent: settling a job twice never charges twice. */
  settle(jobId: string, info: SettleInfo): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// In-memory store: the same rules as supabase/migrations/20250103000000_ai_credits.sql, for tests and local mode.
// ---------------------------------------------------------------------------------------------------------------------

type Job = { id: string; user: string; kind: JobKind; credits: number; key: string; status: "reserved" | "succeeded" | "failed"; at: number; tokensIn?: number; tokensOut?: number; model?: string; errorKind?: string };

export class MemoryCredits implements CreditsStore {
  readonly jobs: Job[] = [];
  private ledger: { user: string; delta: number }[] = [];
  private caps = new Map<string, number>();
  private n = 0;
  constructor(private readonly now: () => number = Date.now, private readonly defaultCap = 40, private readonly holdMs = 10 * 60_000) {}

  grant(user: string, amount: number) {
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000) throw new CreditsError("Invalid amount.");
    this.ledger.push({ user, delta: amount });
  }
  setDailyCap(user: string, cap: number) { this.caps.set(user, cap); }

  private held(user: string) {
    return this.jobs.filter((j) => j.user === user && j.status === "reserved" && this.now() - j.at < this.holdMs).reduce((s, j) => s + j.credits, 0);
  }
  private availableNow(user: string) {
    return this.ledger.filter((l) => l.user === user).reduce((s, l) => s + l.delta, 0) - this.held(user);
  }
  async available(user: string) {
    return this.availableNow(user);
  }
  async reserve(user: string, kind: JobKind, credits: number, key: string): Promise<Reservation> {
    if (!Number.isInteger(credits) || credits < 1 || credits > 100 || key.length < 8 || key.length > 80) throw new CreditsError("Invalid request.");
    // Check-then-record must not yield (no await in between), or two parallel requests could both pass the check.
    // The SQL version gets the same guarantee from an advisory lock per user.
    const existing = this.jobs.find((j) => j.user === user && j.key === key);
    if (existing) {
      const reason: ReserveRefusal = existing.status === "reserved" ? "in_progress" : existing.status === "succeeded" ? "already_done" : "key_reused";
      return { ok: false, reason, available: this.availableNow(user) };
    }
    const avail = this.availableNow(user);
    if (avail < credits) return { ok: false, reason: "insufficient_credits", available: avail };
    const dayStart = new Date(this.now()).setUTCHours(0, 0, 0, 0);
    const today = this.jobs.filter((j) => j.user === user && j.at >= dayStart && (j.status === "succeeded" || (j.status === "reserved" && this.now() - j.at < this.holdMs))).reduce((s, j) => s + j.credits, 0);
    if (today + credits > (this.caps.get(user) ?? this.defaultCap)) return { ok: false, reason: "daily_cap", available: avail };
    const job: Job = { id: `job_${++this.n}`, user, kind, credits, key, status: "reserved", at: this.now() };
    this.jobs.push(job);
    return { ok: true, jobId: job.id, available: avail - credits };
  }
  async settle(jobId: string, info: SettleInfo) {
    const j = this.jobs.find((x) => x.id === jobId);
    if (!j) throw new CreditsError("Unknown job.");
    if (j.status !== "reserved") return; // already settled: never charge twice, never flip
    j.status = info.success ? "succeeded" : "failed";
    j.tokensIn = Math.max(0, info.usage.inputTokens);
    j.tokensOut = Math.max(0, info.usage.outputTokens);
    j.model = info.model?.slice(0, 80);
    j.errorKind = info.success ? undefined : (info.errorKind ?? "unknown").slice(0, 40);
    if (info.success) this.ledger.push({ user: j.user, delta: -j.credits });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Supabase store. MUST be given a SERVICE-ROLE client created on the server; the functions are not callable by users.
// ---------------------------------------------------------------------------------------------------------------------

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { code?: string; message?: string } | null }> };

export class SupabaseCredits implements CreditsStore {
  constructor(private readonly client: Rpc) {}

  async available(user: string) {
    const { data, error } = await this.client.rpc("ai_available", { p_user: user });
    if (error || typeof data !== "number") throw new CreditsError();
    return data;
  }
  async reserve(user: string, kind: JobKind, credits: number, key: string): Promise<Reservation> {
    const { data, error } = await this.client.rpc("ai_reserve", { p_user: user, p_kind: kind, p_credits: credits, p_key: key });
    if (error) {
      if (error.code === "P0402") return { ok: false, reason: "insufficient_credits" };
      if (error.code === "P0429") return { ok: false, reason: "daily_cap" };
      throw new CreditsError();
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.job_id !== "string") throw new CreditsError();
    if (row.status === "reserved" && row.available >= 0) {
      // A reserved job that already existed (same key) is indistinguishable from a fresh one here; the caller's key is
      // unique per request, so treat reserved as ours. Replays of a finished key are reported below.
      return { ok: true, jobId: row.job_id, available: Number(row.available) };
    }
    return { ok: false, reason: row.status === "succeeded" ? "already_done" : "key_reused", available: Number(row.available) };
  }
  async settle(jobId: string, info: SettleInfo) {
    const { error } = await this.client.rpc("ai_settle", {
      p_job: jobId, p_success: info.success, p_tokens_in: info.usage.inputTokens, p_tokens_out: info.usage.outputTokens,
      p_model: info.model ?? null, p_error: info.errorKind ?? null,
    });
    if (error) throw new CreditsError();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type Charged<T> =
  | { status: "refused"; reason: ReserveRefusal; available?: number }
  | { status: "done"; result: T; charged: boolean; jobId: string; settleFailed?: boolean };

/**
 * Reserve, run, settle. Credits are charged only when `result.ok` is true. If `run` throws, the reservation is released and
 * the error is rethrown. If settling itself fails (database down) after a successful run, the result is still returned
 * (the user waited and the work is done) with `settleFailed`; the reservation then expires on its own without a charge.
 */
export async function runCharged<T extends { ok: boolean; usage?: Usage; reason?: string; providerKind?: string }>(o: {
  store: CreditsStore; user: string; kind: JobKind; credits: number; key: string; model?: string;
  run: () => Promise<T>;
  onSettleError?: (e: unknown, jobId: string) => void;
}): Promise<Charged<T>> {
  const r = await o.store.reserve(o.user, o.kind, o.credits, o.key);
  if (!r.ok) return { status: "refused", reason: r.reason, available: r.available };

  const zero: Usage = { inputTokens: 0, outputTokens: 0 };
  let result: T;
  try {
    result = await o.run();
  } catch (e) {
    await o.store.settle(r.jobId, { success: false, usage: zero, model: o.model, errorKind: "exception" }).catch((se) => o.onSettleError?.(se, r.jobId));
    throw e;
  }

  const info: SettleInfo = { success: result.ok, usage: result.usage ?? zero, model: o.model, errorKind: result.ok ? undefined : (result.providerKind ?? result.reason ?? "failed") };
  let settleFailed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await o.store.settle(r.jobId, info);
      settleFailed = false;
      break;
    } catch (e) {
      settleFailed = true;
      if (attempt === 1) o.onSettleError?.(e, r.jobId);
    }
  }
  return { status: "done", result, charged: result.ok && !settleFailed, jobId: r.jobId, ...(settleFailed ? { settleFailed } : {}) };
}
