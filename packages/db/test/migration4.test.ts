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
const MB = 1024 * 1024;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  for (const m of ["20250101000000_init.sql", "20250102000000_sites_forms_derived.sql", "20250103000000_ai_credits.sql", "20250104000000_quotas.sql"]) await db.exec(sql(m));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
});
afterAll(() => db.close());

async function as<T>(who: "alice" | "bob" | "anon", fn: () => Promise<T>): Promise<T> {
  const sub = who === "alice" ? ALICE : who === "bob" ? BOB : "";
  await db.exec(who === "anon" ? `set role anon` : `set role authenticated; select set_config('request.jwt.claim.sub', '${sub}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e: any) { return String(e.message); } throw new Error("expected failure"); };

let n = 0;
const project = (owner: string) => db.query(`insert into projects (owner_id, name, platform, json) values ($1, 'P', 'web', '{"schemaVersion":2,"pages":[]}')`, [owner]);
const asset = (owner: string, id: string, bytes: number) =>
  db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ($1,$2,'a','png','image/png',$3,1,1,$4,$5)
            on conflict (id) do update set bytes = excluded.bytes`, [id, owner, bytes, (++n).toString(16).padStart(64, "0"), `${owner}/${id}`]);

describe("project quota", () => {
  it("allows 25 projects and refuses the 26th, per account", async () => {
    for (let i = 0; i < 25; i++) await as("alice", () => project(ALICE));
    expect(await fails(as("alice", () => project(ALICE)))).toContain("quota_projects");
    await as("bob", () => project(BOB)); // another account is unaffected
  });
  it("deleting a project frees a slot", async () => {
    await as("alice", () => db.query(`delete from projects where id = (select id from projects where owner_id = $1 limit 1)`, [ALICE]));
    await as("alice", () => project(ALICE));
    expect(await fails(as("alice", () => project(ALICE)))).toContain("quota_projects");
  });
  it("my_usage reports only the caller's own numbers", async () => {
    const a = await as("alice", async () => (await db.query<{ u: any }>(`select my_usage() u`)).rows[0]!.u);
    expect(a.projects).toBe(25);
    expect(a.projectsLimit).toBe(25);
    const b = await as("bob", async () => (await db.query<{ u: any }>(`select my_usage() u`)).rows[0]!.u);
    expect(b.projects).toBe(1);
    expect(await fails(as("anon", () => db.query(`select my_usage()`)))).toMatch(/permission denied/);
  });
});

describe("storage quota (200 MB of media per account)", () => {
  it("accepts files up to the limit in total, refuses what would go over", async () => {
    for (let i = 0; i < 9; i++) await as("bob", () => asset(BOB, `asset_b${i}`, 20 * MB)); // 180 MB
    await as("bob", () => asset(BOB, "asset_b9", 20 * MB)); // exactly 200 MB
    expect(await fails(as("bob", () => asset(BOB, "asset_b10", 1)))).toContain("quota_storage");
    const used = await as("bob", async () => (await db.query<{ u: any }>(`select my_usage() u`)).rows[0]!.u.storageBytes);
    expect(Number(used)).toBe(200 * MB);
  });
  it("re-uploading an existing file (an upsert) is not counted twice", async () => {
    await as("bob", () => asset(BOB, "asset_b0", 20 * MB)); // same id, same size, at the limit: still fine
  });
  it("replacing a file with a bigger one must fit, and a smaller one always does", async () => {
    expect(await fails(as("bob", () => asset(BOB, "asset_b0", 21 * MB)))).toContain("quota_storage");
    await as("bob", () => asset(BOB, "asset_b0", 10 * MB));
    await as("bob", () => asset(BOB, "asset_b10", 5 * MB)); // room was freed
  });
  it("another account has its own allowance", async () => {
    for (let i = 0; i < 5; i++) await as("alice", () => asset(ALICE, `asset_a${i}`, 20 * MB)); // 100 MB
  });
  it("deleting files frees space", async () => {
    await as("bob", () => db.query(`delete from assets where owner_id = $1`, [BOB]));
    for (let i = 0; i < 7; i++) await as("bob", () => asset(BOB, `asset_again${i}`, 20 * MB)); // 140 MB fits again
  });
});

describe("saved-message quota", () => {
  it("a site that already holds 5000 messages rejects new ones, without affecting other sites", async () => {
    const proj = async (o: string) => (await db.query<{ id: string }>(`select id from projects where owner_id = $1 limit 1`, [o])).rows[0]!.id;
    const pa = await proj(ALICE);
    const pb = await proj(BOB);
    await as("alice", () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, 'alice-site')`, [ALICE, pa]));
    await as("bob", () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, 'bob-site')`, [BOB, pb]));
    // fill alice's site to the limit directly (as the table owner)
    await db.exec(`insert into form_submissions (site_id, form_id, payload) select s.id, 'f', '{"a":"b"}' from sites s, generate_series(1, 4999) where s.slug = 'alice-site'`);
    const submit = (slug: string) => as("anon", async () => (await db.query(`select submit_form($1, 'f', '{"email":"x@y.co"}'::jsonb, null)`, [slug])).rows);
    // submit_form also has per-minute flood limits; lift them for this test by aging the rows
    await db.exec(`update form_submissions set created_at = now() - interval '1 day'`);
    await submit("alice-site"); // the 5000th is accepted
    await db.exec(`update form_submissions set created_at = now() - interval '1 day'`);
    expect(await fails(submit("alice-site"))).toContain("quota_submissions");
    await submit("bob-site"); // unaffected
  });
  it("the owner deleting messages makes room again", async () => {
    await as("alice", () => db.query(`delete from form_submissions where id in (select id from form_submissions order by created_at limit 10)`));
    await as("anon", () => db.query(`select submit_form('alice-site', 'f', '{"email":"x@y.co"}'::jsonb, null)`));
  });
});

describe("account deletion cascades", () => {
  it("removing a user removes their projects, files, sites and messages, and nobody else's", async () => {
    await db.exec(`delete from auth.users where id = '${ALICE}'`);
    const count = async (t: string, col: string, who: string) => Number((await db.query<{ c: string }>(`select count(*) c from ${t} where ${col} = $1`, [who])).rows[0]!.c);
    for (const [t, c] of [["projects", "owner_id"], ["assets", "owner_id"], ["sites", "owner_id"], ["project_versions", "owner_id"]] as const) expect(await count(t, c, ALICE)).toBe(0);
    expect(Number((await db.query<{ c: string }>(`select count(*) c from form_submissions fs join sites s on s.id = fs.site_id where s.slug = 'alice-site'`)).rows[0]!.c)).toBe(0);
    expect(await count("projects", "owner_id", BOB)).toBeGreaterThan(0);
    expect(await count("assets", "owner_id", BOB)).toBeGreaterThan(0);
  });
});
