import { z } from "zod";

// The server's OWN price list. The browser only ever sends a pack id; it can never choose an amount or a number of credits.

export type Pack = { id: string; label: string; credits: number; amountPaise: number };

/** PLACEHOLDER prices so the flow can be tried. Set your real ones with BILLING_PACKS (see docs/billing.md). The spec leaves pricing open. */
export const DEFAULT_PACKS: Pack[] = [
  { id: "starter", label: "Starter", credits: 50, amountPaise: 9900 },
  { id: "standard", label: "Standard", credits: 200, amountPaise: 29900 },
  { id: "pro", label: "Pro", credits: 600, amountPaise: 79900 },
];

const PackSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,30}$/),
  label: z.string().min(1).max(40),
  credits: z.number().int().min(1).max(100_000),
  amountPaise: z.number().int().min(100).max(10_000_000), // INR 1 to INR 100,000
}).strict();

/** Reads BILLING_PACKS (a JSON array). Strict: a typo must stop the server from selling at a wrong price, never silently fall back. */
export function parsePacks(json: string | undefined): { ok: true; packs: Pack[] } | { ok: false; error: string } {
  if (json === undefined || json.trim() === "") return { ok: true, packs: DEFAULT_PACKS };
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false, error: "BILLING_PACKS is not valid JSON." }; }
  const parsed = z.array(PackSchema).min(1).max(6).safeParse(raw);
  if (!parsed.success) return { ok: false, error: `BILLING_PACKS is invalid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const ids = new Set(parsed.data.map((p) => p.id));
  if (ids.size !== parsed.data.length) return { ok: false, error: "BILLING_PACKS has a repeated id." };
  return { ok: true, packs: parsed.data };
}

export const formatRupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
