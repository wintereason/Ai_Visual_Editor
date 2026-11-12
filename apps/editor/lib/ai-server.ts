import "server-only";
import type { AccountDeps } from "@avc/cloud/src/account";
import type { PublishDeps } from "@avc/publisher/src/publishRoute";
import { MemoryPaymentsStore, parsePacks, SupabasePaymentsStore, type BillingDeps } from "@avc/billing";
import { AnthropicProvider, createModelModerator, MemoryCredits, SupabaseCredits, createRateLimiter, withRetry, type AiDeps, type CreditsStore } from "@avc/ai";
import { createClient } from "@supabase/supabase-js";

// SERVER ONLY. Everything here reads non-public environment variables (no NEXT_PUBLIC_ prefix), which Next.js never
// inlines into browser bundles. `scripts/check-secrets.mjs` verifies that after every build.

/** The one place a model id has a default. Override with AI_MODEL; choose it from evaluation results, not habit. */
const DEFAULT_MODEL = "claude-sonnet-5-5";
/** The safety check uses a small, cheap model. Override with AI_MODERATION_MODEL. */
const DEFAULT_MODERATION_MODEL = "claude-haiku-5-5";

let cached: AiDeps | null = null;

class DevCredits extends MemoryCredits {
  private seen = new Set<string>();
  /** Development convenience: each new user gets a starter balance. Never used when Supabase credits are configured. */
  private ensure(user: string) { if (!this.seen.has(user)) { this.seen.add(user); this.grant(user, 100); } }
  override async available(user: string) { this.ensure(user); return super.available(user); }
  override async reserve(user: string, ...rest: Parameters<MemoryCredits["reserve"]> extends [string, ...infer R] ? R : never) { this.ensure(user); return super.reserve(user, ...rest); }
}

export function getAiDeps(): AiDeps {
  if (cached) return cached;
  const env = process.env;
  const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = supaUrl && serviceKey ? createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const production = env.NODE_ENV === "production";

  const model = env.AI_MODEL || DEFAULT_MODEL;
  // ANTHROPIC_BASE_URL (a gateway, or the fake server used by browser tests) is honoured outside production only, so a stray
  // variable can never redirect the real key somewhere else on a live site.
  const baseUrl = !production && env.ANTHROPIC_BASE_URL ? env.ANTHROPIC_BASE_URL : undefined;
  const provider = env.ANTHROPIC_API_KEY ? withRetry(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model, timeoutMs: 90_000, baseUrl })) : null;

  // Safety checks on AI requests and answers are ON whenever AI is on. Switch off only deliberately (AI_MODERATION=off).
  const moderator = provider && env.AI_MODERATION !== "off"
    ? createModelModerator(withRetry(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY!, model: env.AI_MODERATION_MODEL || DEFAULT_MODERATION_MODEL, timeoutMs: 30_000, baseUrl })))
    : undefined;

  // Credits live in the database when it is configured. Without it, only outside production, fall back to in-memory dev credits.
  const credits: CreditsStore = admin ? new SupabaseCredits(admin as never) : new DevCredits();

  cached = {
    provider,
    moderator,
    credits,
    model,
    newId: () => `ai_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    allow: createRateLimiter({ max: Number(env.AI_RATE_PER_MINUTE) || 12, windowMs: 60_000 }),
    authenticate: async (req) => {
      const header = req.headers.get("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token || token.length > 4096) return null;
      if (admin) {
        const { data, error } = await admin.auth.getUser(token); // verifies the signature and expiry with Supabase
        return error ? null : (data.user?.id ?? null);
      }
      // Development/testing without a database: the in-browser mock backend issues "mock.<id>" tokens. Never in production.
      if (!production && token.startsWith("mock.") && token.length > 6) return token;
      return null;
    },
    log: (e) => console.info("[ai]", JSON.stringify(e)), // metadata only; the handler never logs prompts or project content
  };
  return cached;
}

let cachedAccount: AccountDeps | null = null;

/** Server-side pieces for deleting an account. The admin client only exists when the service-role key is configured. */
export function getAccountDeps(): AccountDeps {
  if (cachedAccount) return cachedAccount;
  const env = process.env;
  const admin = env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  cachedAccount = {
    authenticate: getAiDeps().authenticate, // the same verified-token check the AI endpoints use
    admin: admin && {
      async listFiles(prefix) {
        const { data, error } = await admin.storage.from("assets").list(prefix, { limit: 1000 });
        if (error) throw new Error("list failed");
        return (data ?? []).map((f) => f.name);
      },
      async removeFiles(paths) {
        const { error } = await admin.storage.from("assets").remove(paths);
        if (error) throw new Error("remove failed");
      },
      async deleteUser(id) {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new Error("delete failed");
      },
    },
    log: (e) => console.info("[account]", JSON.stringify(e)),
  };
  return cachedAccount;
}

let cachedPublish: PublishDeps | null = null;

/** Publishing to a person's own Cloudflare account. Their token arrives per request and is never stored or logged. */
export function getPublishDeps(): PublishDeps {
  if (cachedPublish) return cachedPublish;
  const env = process.env;
  // A different Cloudflare address (a test double) is honoured outside production only.
  const baseUrl = env.NODE_ENV !== "production" && env.CLOUDFLARE_API_BASE ? env.CLOUDFLARE_API_BASE : undefined;
  cachedPublish = {
    authenticate: getAiDeps().authenticate,
    allow: createRateLimiter({ max: Number(env.PUBLISH_RATE_PER_MINUTE) || 6, windowMs: 60_000 }),
    cf: baseUrl ? { baseUrl } : {},
    log: (e) => console.info("[publish]", JSON.stringify(e)),
  };
  return cachedPublish;
}

let cachedBilling: BillingDeps | null = null;

/**
 * Buying credit packs. Needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET (all server-only). Without them, or
 * with an invalid BILLING_PACKS, purchases are simply switched off. In production payments are recorded in the database
 * (migration 5, service-role only); without a database, only outside production, they are kept in memory so the flow can be tried.
 */
export function getBillingDeps(): BillingDeps {
  if (cachedBilling) return cachedBilling;
  const env = process.env;
  const ai = getAiDeps();
  const production = env.NODE_ENV === "production";
  const packs = parsePacks(env.BILLING_PACKS);
  if (!packs.ok) console.error("[billing]", packs.error); // a typo here must never sell at a wrong price
  const configured = packs.ok && !!env.RAZORPAY_KEY_ID && !!env.RAZORPAY_KEY_SECRET;
  const admin = env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const mem = ai.credits as unknown as { grant?: (user: string, n: number) => void };
  const store = admin
    ? new SupabasePaymentsStore(admin as never)
    : !production && typeof mem.grant === "function" ? new MemoryPaymentsStore((u, n) => mem.grant!(u, n)) : null;
  const apiBase = !production && env.RAZORPAY_API_BASE ? env.RAZORPAY_API_BASE : undefined; // test doubles: never in production

  cachedBilling = {
    authenticate: ai.authenticate,
    allow: createRateLimiter({ max: Number(env.BILLING_RATE_PER_MINUTE) || 10, windowMs: 60_000 }),
    packs: packs.ok ? packs.packs : [],
    razorpay: configured && store ? { keyId: env.RAZORPAY_KEY_ID!, keySecret: env.RAZORPAY_KEY_SECRET!, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || undefined, baseUrl: apiBase } : null,
    store: store ?? new MemoryPaymentsStore(() => {}), // never reached when razorpay is null
    credits: ai.credits,
    newId: () => crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    log: (e) => console.info("[billing]", JSON.stringify(e)),
  };
  return cachedBilling;
}
