import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");

const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls; -- as in Supabase: the service role is not subject to RLS
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
`;
const GRANTS = `
  grant select, insert, update, delete on all tables in schema public to authenticated, anon;
  grant all on all tables in schema public to service_role;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets, storage.objects to anon;
`;

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const m of ["20250101000000_init.sql", "20250102000000_sites_forms_derived.sql", "20250103000000_ai_credits.sql"]) await db.exec(sql(m));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
});
afterAll(() => db.close());

type Role = "service" | "alice" | "bob" | "anon" | "super";
async function as<T>(who: Role, fn: () => Promise<T>): Promise<T> {
  if (who === "super") return fn();
  const sub = who === "alice" ? ALICE : who === "bob" ? BOB : "";
  await db.exec(who === "service" ? `set role service_role` : who === "anon" ? `set role anon` : `set role authenticated; select set_config('request.jwt.claim.sub', '${sub}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e: any) { return { code: e.code as string | undefined, message: String(e.message) }; } throw new Error("expected failure"); };

let k = 0;
const key = () => `key-${Date.now()}-${++k}-xxxxxxxx`;
const grant = (user: string, n: number) => as("service", () => db.query(`select grant_credits($1, $2, 'test')`, [user, n]));
const reserve = (user: string, kind: string, credits: number, idem = key()) =>
  as("service", async () => (await db.query<{ job_id: string; status: string; available: number }>(`select * from ai_reserve($1, $2, $3, $4)`, [user, kind, credits, idem])).rows[0]!);
const settle = (job: string, ok: boolean, tin = 100, tout = 50, model = "m", err: string | null = null) =>
  as("service", async () => (await db.query<{ ai_settle: string }>(`select ai_settle($1, $2, $3, $4, $5, $6)`, [job, ok, tin, tout, model, err])).rows[0]!.ai_settle);
const available = async (user: string) => as("service", async () => (await db.query<{ a: number }>(`select ai_available($1) a`, [user])).rows[0]!.a);
const fresh = async () => { // a brand-new user so tests do not share balances
  const id = crypto.randomUUID();
  await db.exec(`insert into auth.users (id) values ('${id}')`);
  return id;
};

describe("grants and balance", () => {
  it("a new user has nothing; granting adds to the balance", async () => {
    const u = await fresh();
    expect(await available(u)).toBe(0);
    await grant(u, 10);
    await grant(u, 5);
    expect(await available(u)).toBe(15);
  });
  it("only the server can grant credits; users cannot give themselves any", async () => {
    const u = await fresh();
    await fails(as("alice", () => db.query(`select grant_credits($1, 100, 'free')`, [ALICE])));
    await fails(as("anon", () => db.query(`select grant_credits($1, 100, 'free')`, [u])));
    await fails(as("alice", () => db.query(`insert into credits_ledger (user_id, delta, reason) values ($1, 1000, 'self')`, [ALICE])));
    expect(await available(u)).toBe(0);
  });
  it("rejects zero, negative and absurd grants", async () => {
    const u = await fresh();
    for (const n of [0, -5, 100001]) expect((await fails(as("service", () => db.query(`select grant_credits($1, $2, 'x')`, [u, n])))).code).toBe("22023");
  });
  it("a signed-in user can read only their own balance through ai_balance()", async () => {
    await grant(ALICE, 7);
    await grant(BOB, 3);
    const a = await as("alice", async () => (await db.query<{ ai_balance: number }>(`select ai_balance()`)).rows[0]!.ai_balance);
    const b = await as("bob", async () => (await db.query<{ ai_balance: number }>(`select ai_balance()`)).rows[0]!.ai_balance);
    expect(a).toBeGreaterThanOrEqual(7);
    expect(b).toBeGreaterThanOrEqual(3);
    expect(a).not.toBe(b + 0.5);
    await fails(as("anon", () => db.query(`select ai_balance()`)));
  });
});

describe("reserve and settle", () => {
  it("reserving lowers what is available at once; success charges exactly the reserved credits", async () => {
    const u = await fresh();
    await grant(u, 10);
    const r = await reserve(u, "layout", 3);
    expect(r).toMatchObject({ status: "reserved", available: 7 });
    expect(await available(u)).toBe(7);
    expect(await settle(r.job_id, true, 1200, 800, "claude-x")).toBe("succeeded");
    expect(await available(u)).toBe(7); // the charge replaced the reservation
    const ledger = (await db.query<{ delta: number; reason: string }>(`select delta, reason from credits_ledger where user_id = $1 order by id`, [u])).rows;
    expect(ledger).toEqual([{ delta: 10, reason: "test" }, { delta: -3, reason: "ai:layout" }]);
    const job = (await db.query<any>(`select status, tokens_in, tokens_out, model, finished_at from ai_jobs where id = $1`, [r.job_id])).rows[0];
    expect(job).toMatchObject({ status: "succeeded", tokens_in: 1200, tokens_out: 800, model: "claude-x" });
    expect(job.finished_at).toBeTruthy();
  });
  it("a failed job releases the reservation and charges nothing, but still records the tokens that were spent", async () => {
    const u = await fresh();
    await grant(u, 10);
    const r = await reserve(u, "patch", 1);
    expect(await settle(r.job_id, false, 900, 0, "m", "invalid")).toBe("failed");
    expect(await available(u)).toBe(10);
    const job = (await db.query<any>(`select status, tokens_in, error_kind from ai_jobs where id = $1`, [r.job_id])).rows[0];
    expect(job).toMatchObject({ status: "failed", tokens_in: 900, error_kind: "invalid" });
    expect((await db.query(`select 1 from credits_ledger where user_id = $1 and delta < 0`, [u])).rows).toHaveLength(0);
  });
  it("settling twice never charges twice, and a settled job cannot be flipped", async () => {
    const u = await fresh();
    await grant(u, 10);
    const r = await reserve(u, "element", 2);
    await settle(r.job_id, true);
    expect(await settle(r.job_id, true)).toBe("succeeded");
    expect(await settle(r.job_id, false)).toBe("succeeded"); // a later "failed" cannot refund a charged job
    expect(await available(u)).toBe(8);
    const f = await reserve(u, "element", 2);
    await settle(f.job_id, false);
    expect(await settle(f.job_id, true)).toBe("failed"); // nor can a failed job be turned into a charge
    expect(await available(u)).toBe(8);
  });
  it("the same idempotency key returns the same job instead of reserving twice", async () => {
    const u = await fresh();
    await grant(u, 10);
    const idem = key();
    const a = await reserve(u, "patch", 1, idem);
    const b = await reserve(u, "patch", 1, idem);
    expect(b.job_id).toBe(a.job_id);
    expect(await available(u)).toBe(9);
    await settle(a.job_id, true);
    const c = await reserve(u, "patch", 1, idem);
    expect(c).toMatchObject({ job_id: a.job_id, status: "succeeded" }); // a retried request learns it already ran
    expect(await available(u)).toBe(9);
  });
  it("keys are per user: another user's identical key is a different job", async () => {
    const [x, y] = [await fresh(), await fresh()];
    await grant(x, 5); await grant(y, 5);
    const idem = key();
    expect((await reserve(x, "patch", 1, idem)).job_id).not.toBe((await reserve(y, "patch", 1, idem)).job_id);
  });
  it("cannot overspend: the second reservation is refused when the first still holds the credits", async () => {
    const u = await fresh();
    await grant(u, 3);
    await reserve(u, "layout", 2);
    expect((await fails(reserve(u, "layout", 2))).code).toBe("P0402");
    await reserve(u, "patch", 1); // exactly what is left is fine
    expect(await available(u)).toBe(0);
    expect((await fails(reserve(u, "patch", 1))).code).toBe("P0402");
  });
  it("a refused reservation leaves no job behind and no side effects", async () => {
    const u = await fresh();
    await grant(u, 1);
    await fails(reserve(u, "layout", 3, "refused-key-1"));
    expect((await db.query(`select 1 from ai_jobs where user_id = $1`, [u])).rows).toHaveLength(0);
    expect(await available(u)).toBe(1);
  });
  it("releasing a failed reservation frees the credits for the next request", async () => {
    const u = await fresh();
    await grant(u, 2);
    const a = await reserve(u, "layout", 2);
    expect((await fails(reserve(u, "patch", 1))).code).toBe("P0402");
    await settle(a.job_id, false, 0, 0, "m", "provider");
    await reserve(u, "patch", 1);
  });
  it("a reservation abandoned for 10 minutes stops holding credits (a crashed server does not lock a user out)", async () => {
    const u = await fresh();
    await grant(u, 5);
    const a = await reserve(u, "layout", 3);
    expect(await available(u)).toBe(2);
    await db.query(`update ai_jobs set created_at = now() - interval '11 minutes' where id = $1`, [a.job_id]);
    expect(await available(u)).toBe(5);
  });
  it("validates inputs: unknown kinds, zero or huge credits, short keys", async () => {
    const u = await fresh();
    await grant(u, 500);
    expect((await fails(reserve(u, "hack", 1))).message).toMatch(/check constraint/i);
    expect((await fails(reserve(u, "patch", 0))).message).toMatch(/check constraint|insufficient/i);
    await fails(reserve(u, "patch", 101));
    await fails(reserve(u, "patch", 1, "short"));
    await fails(as("service", () => db.query(`select * from ai_reserve(null, 'patch', 1, $1)`, [key()])));
  });
  it("settling an unknown job is an error", async () => {
    expect((await fails(settle(crypto.randomUUID(), true))).code).toBe("P0002");
  });
});

describe("daily cap", () => {
  it("stops spending at the cap, counting reservations and successes but not failures", async () => {
    const u = await fresh();
    await grant(u, 1000);
    await as("service", () => db.query(`insert into credit_limits (user_id, daily_cap) values ($1, 5)`, [u]));
    const a = await reserve(u, "layout", 3);
    expect((await fails(reserve(u, "layout", 3))).code).toBe("P0429"); // 3 held + 3 > 5
    await settle(a.job_id, false);
    const b = await reserve(u, "layout", 3); // failure freed the cap
    await settle(b.job_id, true);
    await reserve(u, "patch", 2);
    expect((await fails(reserve(u, "patch", 1))).code).toBe("P0429"); // 3 charged + 2 held = 5
  });
  it("yesterday's spending does not count, and a cap of 0 blocks everything", async () => {
    const u = await fresh();
    await grant(u, 1000);
    await as("service", () => db.query(`insert into credit_limits (user_id, daily_cap) values ($1, 3)`, [u]));
    const a = await reserve(u, "layout", 3);
    await settle(a.job_id, true);
    expect((await fails(reserve(u, "patch", 1))).code).toBe("P0429");
    await db.query(`update ai_jobs set created_at = now() - interval '2 days' where id = $1`, [a.job_id]);
    await reserve(u, "patch", 1);
    const z = await fresh();
    await grant(z, 10);
    await as("service", () => db.query(`insert into credit_limits (user_id, daily_cap) values ($1, 0)`, [z]));
    expect((await fails(reserve(z, "patch", 1))).code).toBe("P0429");
  });
  it("the default cap is 40 a day", async () => {
    const u = await fresh();
    await grant(u, 1000);
    for (let i = 0; i < 4; i++) await settle((await reserve(u, "layout", 10)).job_id, true);
    expect((await fails(reserve(u, "patch", 1))).code).toBe("P0429");
  });
});

describe("who can see and do what", () => {
  it("users read only their own jobs, ledger and limits", async () => {
    const a = await grant(ALICE, 5) && (await reserve(ALICE, "patch", 1)).job_id;
    const bobSees = await as("bob", async () => (await db.query(`select id from ai_jobs where id = $1`, [a])).rows);
    expect(bobSees).toEqual([]);
    const aliceSees = await as("alice", async () => (await db.query(`select id from ai_jobs where id = $1`, [a])).rows);
    expect(aliceSees).toHaveLength(1);
    expect((await as("alice", async () => (await db.query<{ user_id: string }>(`select distinct user_id from credits_ledger`)).rows)).every((r) => r.user_id === ALICE)).toBe(true);
    expect(await as("anon", async () => (await db.query(`select * from ai_jobs`)).rows)).toEqual([]);
  });
  it("users and visitors cannot write jobs, ledger rows or limits directly", async () => {
    await fails(as("alice", () => db.query(`insert into ai_jobs (user_id, kind, credits, idempotency_key) values ($1, 'patch', 1, 'direct-insert-1')`, [ALICE])));
    await fails(as("alice", () => db.query(`insert into credit_limits (user_id, daily_cap) values ($1, 100000)`, [ALICE])));
    expect((await as("alice", () => db.query(`update ai_jobs set credits = 1 where user_id = $1`, [ALICE]))).affectedRows).toBe(0);
    expect((await as("alice", () => db.query(`delete from credits_ledger where user_id = $1`, [ALICE]))).affectedRows).toBe(0);
    await fails(as("anon", () => db.query(`insert into ai_jobs (user_id, kind, credits, idempotency_key) values ($1, 'patch', 1, 'anon-insert-1')`, [ALICE])));
  });
  it("users and visitors cannot reserve or settle, so a client cannot dodge being charged", async () => {
    const u = await fresh();
    await grant(u, 5);
    const r = await reserve(u, "layout", 3);
    for (const who of ["alice", "anon"] as const) {
      await fails(as(who, () => db.query(`select * from ai_reserve($1, 'patch', 1, $2)`, [u, key()])));
      await fails(as(who, () => db.query(`select ai_settle($1, false, 0, 0, 'm', 'x')`, [r.job_id])));
      await fails(as(who, () => db.query(`select ai_available($1)`, [u])));
    }
    expect(await settle(r.job_id, true)).toBe("succeeded"); // the server's settle still works, and was not pre-empted
  });
  it("deleting a user removes their jobs, ledger and limits", async () => {
    const u = await fresh();
    await grant(u, 5);
    await reserve(u, "patch", 1);
    await db.exec(`delete from auth.users where id = '${u}'`);
    for (const t of ["ai_jobs", "credits_ledger"]) expect((await db.query(`select 1 from ${t} where user_id = $1`, [u])).rows).toHaveLength(0);
  });
});

describe("earlier protections still hold", () => {
  it("anonymous callers still cannot use submit_form's neighbours: save_project, snapshot_project", async () => {
    await fails(as("anon", () => db.query(`select * from save_project($1, 1, '{}'::jsonb)`, [crypto.randomUUID()])));
    await fails(as("anon", () => db.query(`select snapshot_project($1)`, [crypto.randomUUID()])));
  });
});
