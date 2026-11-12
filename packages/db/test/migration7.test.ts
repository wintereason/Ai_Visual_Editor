import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
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
const OLD = ["20250101000000_init.sql", "20250102000000_sites_forms_derived.sql", "20250103000000_ai_credits.sql", "20250104000000_quotas.sql", "20250105000000_payments.sql", "20250106000000_collaboration.sql"];
const NEW = "20250107000000_asset_ids_per_owner.sql";
const U = { alice: "00000000-0000-0000-0000-00000000000a", bob: "00000000-0000-0000-0000-00000000000b", carol: "00000000-0000-0000-0000-00000000000c" } as const;
type Who = keyof typeof U;

async function database(migrations: string[]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUBS);
  for (const m of migrations) await db.exec(sql(m));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id, email) values ('${U.alice}', 'alice@example.com'), ('${U.bob}', 'bob@example.com'), ('${U.carol}', 'carol@example.com')`);
  return db;
}
const as = async <T,>(db: PGlite, who: Who, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U[who]}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
};
const HASH = "a".repeat(64);
const SAME_FILE_ID = `asset_${HASH.slice(0, 24)}`; // exactly how the editor derives an id from a file's content
const insert = (db: PGlite, who: Who, id = SAME_FILE_ID, hash = HASH, bytes = 100) =>
  as(db, who, () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ($1,$2,'pic','png','image/png',$3,1,1,$4,$5)`, [id, U[who], bytes, hash, `${U[who]}/${id}`]));
const upsert = (db: PGlite, who: Who, id = SAME_FILE_ID, hash = HASH) =>
  as(db, who, () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ($1,$2,'pic','png','image/png',100,1,1,$3,$4) on conflict (owner_id, id) do update set name = excluded.name`, [id, U[who], hash, `${U[who]}/${id}`]));
const mine = (db: PGlite, who: Who) => as(db, who, async () => (await db.query<{ id: string; owner_id: string }>(`select id, owner_id from assets`)).rows);

describe("the bug, on the schema as it was (migrations 1 to 6)", () => {
  let before: PGlite;
  beforeAll(async () => { before = await database(OLD); });
  afterAll(() => before.close());

  it("a second account uploading the same picture collides with the first account's row", async () => {
    await insert(before, "alice");
    await expect(insert(before, "bob")).rejects.toMatchObject({ code: "23505" }); // duplicate key on the id alone
    expect(await mine(before, "bob")).toEqual([]); // and bob ends up with no copy at all
  });
});

describe("after migration 7: each account holds its own row for the same picture", () => {
  let db: PGlite;
  beforeAll(async () => { db = await database([...OLD, NEW]); });
  afterAll(() => db.close());

  it("two accounts can upload identical files", async () => {
    await insert(db, "alice");
    await insert(db, "bob");
    expect(await mine(db, "alice")).toEqual([{ id: SAME_FILE_ID, owner_id: U.alice }]);
    expect(await mine(db, "bob")).toEqual([{ id: SAME_FILE_ID, owner_id: U.bob }]);
  });

  it("access isolation is unchanged: nobody sees, edits or deletes another account's row, even with the same id", async () => {
    expect(await mine(db, "carol")).toEqual([]);
    const upd = await as(db, "bob", () => db.query(`update assets set name = 'hijacked' where owner_id = $1 returning id`, [U.alice]));
    const del = await as(db, "bob", () => db.query(`delete from assets where owner_id = $1 returning id`, [U.alice]));
    expect(upd.rows.length + del.rows.length).toBe(0);
    // an update by id alone only ever touches the caller's own row
    const own = await as(db, "bob", () => db.query(`update assets set name = 'bobs' where id = $1 returning owner_id`, [SAME_FILE_ID]));
    expect(own.rows).toEqual([{ owner_id: U.bob }]);
    expect((await as(db, "alice", async () => (await db.query<{ name: string }>(`select name from assets where id = $1`, [SAME_FILE_ID])).rows))[0]!.name).toBe("pic");
  });

  it("an account can't create a row in someone else's name", async () => {
    await expect(as(db, "carol", () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ('asset_zz1', $1, 'x','png','image/png',1,1,1,$2,$3)`, [U.alice, "b".repeat(64), `${U.alice}/asset_zz1`]))).rejects.toThrow();
  });

  it("repeated uploads by the same account are idempotent (an upsert on owner + id), never a duplicate", async () => {
    await upsert(db, "alice");
    await upsert(db, "alice");
    expect((await mine(db, "alice")).filter((r) => r.id === SAME_FILE_ID)).toHaveLength(1);
  });

  it("the per-account rules are still enforced: one row per picture per account, and keys stay inside the account's folder", async () => {
    await expect(insert(db, "alice", "asset_otherid", HASH)).rejects.toMatchObject({ code: "23505" }); // same bytes under another id
    await expect(as(db, "alice", () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ('asset_k1', $1,'x','png','image/png',1,1,1,$2,'someone-else/asset_k1')`, [U.alice, "c".repeat(64)]))).rejects.toThrow();
  });

  it("storage usage is counted per account: each account's copy counts once, against that account only", async () => {
    const usage = (who: Who) => as(db, who, async () => (await db.query<{ u: { storageBytes: number } }>(`select my_usage() u`)).rows[0]!.u.storageBytes);
    expect(await usage("alice")).toBe(100); // her one 100-byte copy: bob's identical copy is not added to her total
    expect(await usage("bob")).toBe(100);
    expect(await usage("carol")).toBe(0);
  });

  it("deleting one account's row leaves the other's intact (no shared fate)", async () => {
    await as(db, "alice", () => db.query(`delete from assets where id = $1`, [SAME_FILE_ID]));
    expect(await mine(db, "bob")).toEqual([{ id: SAME_FILE_ID, owner_id: U.bob }]);
  });

  it("sharing still works: a member sees the pictures a shared project uses, and a project owned by someone else naming the id grants nothing", async () => {
    await insert(db, "alice", "asset_shared01", "d".repeat(64));
    const json = JSON.stringify({ schemaVersion: 2, id: "p", name: "P", platform: "web", pages: [{ id: "pg", name: "H", path: "/", nodes: [{ id: "i", props: { assetId: "asset_shared01" } }] }] });
    const pid = await as(db, "alice", async () => (await db.query<{ id: string }>(`insert into projects (owner_id, name, platform, json) values ($1,'P','web',$2::jsonb) returning id`, [U.alice, json])).rows[0]!.id);
    await as(db, "alice", () => db.query(`select share_project($1, 'bob@example.com', 'viewer')`, [pid]));
    await as(db, "bob", () => db.query(`select claim_invites()`));
    const seen = await as(db, "bob", async () => (await db.query(`select 1 from assets where id = 'asset_shared01'`)).rows.length);
    expect(seen).toBe(1);
    expect(await as(db, "carol", async () => (await db.query(`select 1 from assets where id = 'asset_shared01'`)).rows.length)).toBe(0);
  });
});

describe("migration 7 is safe to apply to a database that already has data", () => {
  it("keeps every existing row and the access rules, and can be applied twice", async () => {
    const db = await database(OLD);
    await insert(db, "alice", "asset_existing1", "e".repeat(64));
    await insert(db, "bob", "asset_existing2", "f".repeat(64));
    await db.exec(sql(NEW));
    await db.exec(sql(NEW)); // running it again changes nothing and doesn't fail
    expect((await db.query<{ n: number }>(`select count(*)::int n from assets`)).rows[0]!.n).toBe(2);
    expect(await mine(db, "alice")).toEqual([{ id: "asset_existing1", owner_id: U.alice }]);
    const pk = await db.query<{ cols: string }>(`select string_agg(a.attname, ',' order by array_position(i.indkey::int[], a.attnum::int)) cols from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'public.assets'::regclass and i.indisprimary`);
    expect(pk.rows[0]!.cols).toBe("owner_id,id");
    await db.close();
  });
});
