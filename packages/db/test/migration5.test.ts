import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
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
  await db.exec(STUBS);
  for (const m of ["20250101000000_init.sql", "20250102000000_sites_forms_derived.sql", "20250103000000_ai_credits.sql", "20250104000000_quotas.sql", "20250105000000_payments.sql"]) await db.exec(sql(m));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
});
afterAll(() => db.close());

type Role = "service" | "alice" | "bob" | "anon";
async function as<T>(who: Role, fn: () => Promise<T>): Promise<T> {
  const sub = who === "alice" ? ALICE : who === "bob" ? BOB : "";
  await db.exec(who === "service" ? "set role service_role" : who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub', '${sub}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e: any) { return String(e.message); } throw new Error("expected failure"); };

let n = 0;
const order = () => `order_test${String(++n).padStart(6, "0")}`;
const pay = () => `pay_test${String(++n).padStart(6, "0")}`;
const create = (user: string, orderId: string, over: { credits?: number; amount?: number; pack?: string } = {}) =>
  as("service", () => db.query(`insert into payments (user_id, order_id, pack_id, credits, amount_paise, currency) values ($1,$2,$3,$4,$5,'INR')`, [user, orderId, over.pack ?? "starter", over.credits ?? 50, over.amount ?? 9900]));
const apply = (orderId: string, paymentId: string, amount = 9900, currency = "INR") =>
  as("service", async () => (await db.query<{ r: string }>(`select apply_payment($1,$2,$3,$4) r`, [orderId, paymentId, amount, currency])).rows[0]!.r);
const balance = (user: string) => as("service", async () => (await db.query<{ a: number }>(`select ai_available($1) a`, [user])).rows[0]!.a);

describe("apply_payment grants credits exactly once", () => {
  it("grants the credits the server recorded, when the amount and currency match", async () => {
    const o = order();
    await create(ALICE, o);
    expect(await apply(o, pay())).toBe("granted");
    expect(await balance(ALICE)).toBe(50);
    const row = (await as("service", () => db.query<any>(`select status, payment_id, paid_at from payments where order_id = $1`, [o]))).rows[0];
    expect(row.status).toBe("paid");
    expect(row.paid_at).not.toBeNull();
  });
  it("the same order reported again (webhook retry, browser plus webhook) grants nothing more", async () => {
    const o = order();
    await create(BOB, o, { credits: 200, amount: 29900 });
    const p = pay();
    expect(await apply(o, p, 29900)).toBe("granted");
    expect(await apply(o, p, 29900)).toBe("already");
    expect(await apply(o, pay(), 29900)).toBe("already"); // even with a different payment id
    expect(await balance(BOB)).toBe(200);
  });
  it("many simultaneous reports still grant once", async () => {
    const o = order();
    await create(ALICE, o, { credits: 7, amount: 5000 });
    const before = await balance(ALICE);
    const p = pay();
    const results = await Promise.all(Array.from({ length: 8 }, () => apply(o, p, 5000)));
    expect(results.filter((r) => r === "granted")).toHaveLength(1);
    expect(await balance(ALICE)).toBe(before + 7);
  });
  it("refuses to grant when the amount or currency differs from what the server expected", async () => {
    const o = order();
    await create(ALICE, o, { credits: 50, amount: 9900 });
    const before = await balance(ALICE);
    expect(await apply(o, pay(), 100)).toBe("mismatch"); // paid ₹1 for a ₹99 pack
    expect(await apply(o, pay(), 9900, "USD")).toBe("mismatch");
    expect(await apply(o, pay(), 99000)).toBe("mismatch"); // any difference, even paying more
    expect(await balance(ALICE)).toBe(before);
    expect(await apply(o, pay(), 9900)).toBe("granted"); // the correct report still works afterwards
  });
  it("an unknown order grants nothing", async () => {
    const before = await balance(ALICE);
    expect(await apply("order_doesnotexist", pay())).toBe("unknown");
    expect(await balance(ALICE)).toBe(before);
  });
  it("rejects malformed payment ids", async () => {
    const o = order();
    await create(ALICE, o);
    for (const bad of ["", "x", "bad id with spaces", "pay_'; drop table payments;--"]) expect(await fails(apply(o, bad))).toMatch(/invalid_payment_id/);
  });
  it("the credits land in the ledger with a purchase reason", async () => {
    const rows = (await as("service", () => db.query<any>(`select reason, delta from credits_ledger where reason like 'purchase %' order by id desc limit 1`))).rows;
    expect(rows[0]).toMatchObject({ delta: expect.any(Number) });
    expect(rows[0].reason).toMatch(/^purchase /);
  });
});

describe("only the server can touch money", () => {
  it("browsers (signed in or not) cannot call apply_payment", async () => {
    const o = order();
    await create(ALICE, o);
    for (const who of ["alice", "bob", "anon"] as const) expect(await fails(as(who, () => db.query(`select apply_payment($1,$2,9900,'INR')`, [o, pay()])))).toMatch(/permission denied/);
    expect(await balance(ALICE)).toBeGreaterThanOrEqual(0);
  });
  it("browsers cannot insert, edit or delete payments", async () => {
    const o = order();
    for (const who of ["alice", "anon"] as const) {
      expect(await fails(as(who, () => db.query(`insert into payments (user_id, order_id, pack_id, credits, amount_paise, currency) values ($1,$2,'x',1000,100,'INR')`, [ALICE, order()])))).toMatch(/row-level security|permission denied/);
    }
    await create(ALICE, o);
    await as("alice", () => db.query(`update payments set status = 'paid', payment_id = 'pay_forged000', paid_at = now() where order_id = $1`, [o])); // RLS: matches no rows
    await as("alice", () => db.query(`delete from payments where order_id = $1`, [o]));
    const row = (await as("service", () => db.query<any>(`select status from payments where order_id = $1`, [o]))).rows[0];
    expect(row.status).toBe("created"); // still there, still unpaid
  });
  it("people can read their own payments and nobody else's", async () => {
    const mine = (await as("alice", () => db.query<any>(`select user_id from payments`))).rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.user_id === ALICE)).toBe(true);
    expect((await as("anon", () => db.query(`select * from payments`))).rows).toHaveLength(0);
  });
  it("a payment that claims to be paid must have a payment id and date (no half-states)", async () => {
    expect(await fails(as("service", () => db.query(`insert into payments (user_id, order_id, pack_id, credits, amount_paise, currency, status) values ($1,$2,'x',5,500,'INR','paid')`, [ALICE, order()])))).toMatch(/payments_paid_has_payment/);
  });
  it("invalid amounts, currencies and credit counts are rejected by the table itself", async () => {
    for (const [credits, amount, cur] of [[0, 500, "INR"], [100001, 500, "INR"], [5, 50, "INR"], [5, 500, "USD"], [5, 200000000, "INR"]] as const)
      expect(await fails(as("service", () => db.query(`insert into payments (user_id, order_id, pack_id, credits, amount_paise, currency) values ($1,$2,'x',$3,$4,$5)`, [ALICE, order(), credits, amount, cur])))).toMatch(/check constraint/);
  });
  it("two payments cannot share an order or a payment id", async () => {
    const o = order();
    await create(ALICE, o);
    expect(await fails(create(BOB, o))).toMatch(/unique|duplicate/);
  });
  it("deleting an account removes its payment records", async () => {
    const u = "00000000-0000-0000-0000-0000000000cc";
    await db.exec(`insert into auth.users (id) values ('${u}')`);
    await create(u, order());
    await db.exec(`delete from auth.users where id = '${u}'`);
    expect((await db.query(`select 1 from payments where user_id = '${u}'`)).rows).toHaveLength(0);
  });
});
