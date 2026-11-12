// SERVER ONLY. Deleting an account needs the service-role key, so this must never be imported by browser code.
// (The editor's bundle imports "@avc/cloud" through its index; this file is deliberately NOT exported from it. Import it by path.)

/** The few admin operations needed, so this can be tested without Supabase. */
export interface AdminLike {
  listFiles(prefix: string): Promise<string[]>;
  removeFiles(paths: string[]): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export type AccountDeps = {
  /** Verifies the credential and returns the signed-in user's id, or null. Never trust a client-supplied id. */
  authenticate: (req: Request) => Promise<string | null>;
  admin: AdminLike | null;
  log?: (event: Record<string, unknown>) => void;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => json(status, { ok: false, code, message });

const MAX_ROUNDS = 100; // 100 rounds of up to 1000 files: far beyond any account's quota, and a hard stop against looping forever

/**
 * DELETE /api/account with body {"confirm":"DELETE"}. Removes the person's stored files, then the account itself; the database
 * deletes everything else (projects, versions, media records, sites, messages, AI usage) through foreign-key cascades.
 * Files go first: if that fails the account is untouched and the person can simply try again.
 */
export async function handleDeleteAccount(req: Request, deps: AccountDeps): Promise<Response> {
  if (req.method !== "DELETE") return json(405, { ok: false, code: "method_not_allowed", message: "Use DELETE." });
  if (!deps.admin) return fail(503, "not_configured", "Account deletion isn't available on this server.");

  const userId = await deps.authenticate(req).catch(() => null);
  if (!userId) return fail(401, "unauthorized", "Sign in again to continue.");

  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== "DELETE") {
    return fail(400, "not_confirmed", "Deletion must be confirmed.");
  }

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const names = await deps.admin.listFiles(userId);
      if (names.length === 0) break;
      // Only ever this user's own folder: the prefix is the verified id, and every path is rebuilt from it.
      await deps.admin.removeFiles(names.map((n) => `${userId}/${n.replace(/^.*\//, "")}`));
    }
    await deps.admin.deleteUser(userId);
  } catch {
    deps.log?.({ event: "account_delete_failed" }); // no ids, no error text
    return fail(503, "failed", "Couldn't delete the account. Nothing was lost; please try again.");
  }
  deps.log?.({ event: "account_deleted" });
  return json(200, { ok: true });
}
