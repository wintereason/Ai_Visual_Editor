import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20250101000000_init.sql", import.meta.url)), "utf8");

// Minimal stand-ins for what Supabase provides, so the real migration runs unchanged.
const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create role anon nologin;
  create role authenticated nologin;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

  grant usage on schema public, auth, storage to anon, authenticated;
`;
const GRANTS = `
  -- Supabase grants table privileges to these roles by default; RLS is what actually restricts rows.
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant select on all tables in schema public to anon;
  grant select on storage.objects, storage.buckets to anon;
`;

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(MIGRATION);
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
});
afterAll(() => db.close());

/** Run `fn` as an authenticated user (RLS applies), then restore the superuser. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)` : `set role anon`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const fails = async (p: Promise<unknown>): Promise<{ code?: string; message: string }> => {
  try {
    await p;
  } catch (e: any) {
    return { code: e.code, message: String(e.message) };
  }
  throw new Error("expected the statement to fail, but it succeeded");
};

const doc = (name = "Site") => ({ schemaVersion: 2, id: "p", name, platform: "web", pages: [{ id: "pg", name: "Home", path: "/", nodes: [] }] });
const insertProject = async (owner: string, json: unknown = doc()) =>
  (await db.query<{ id: string }>(`insert into projects (owner_id, name, platform, json) values ($1, 'Site', 'web', $2) returning id`, [owner, JSON.stringify(json)])).rows[0]!.id;

describe("projects: row level security", () => {
  it("an owner can create, read, rename and delete their project", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    const rows = await as(ALICE, async () => (await db.query(`select id, version from projects`)).rows);
    expect(rows).toEqual([{ id, version: 1 }]);
    await as(ALICE, () => db.query(`update projects set name = 'Renamed' where id = $1`, [id]));
    expect(((await db.query<{ name: string }>(`select name from projects where id = $1`, [id])).rows[0]!).name).toBe("Renamed");
    await as(ALICE, () => db.query(`delete from projects where id = $1`, [id]));
    expect((await db.query(`select 1 from projects where id = $1`, [id])).rows).toHaveLength(0);
  });

  it("another user cannot see, update or delete it", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    expect(await as(BOB, async () => (await db.query(`select id from projects where id = $1`, [id])).rows)).toEqual([]);
    const upd = await as(BOB, () => db.query(`update projects set name = 'pwned' where id = $1`, [id]));
    expect(upd.affectedRows).toBe(0);
    const del = await as(BOB, () => db.query(`delete from projects where id = $1`, [id]));
    expect(del.affectedRows).toBe(0);
    expect(((await db.query<{ name: string }>(`select name from projects where id = $1`, [id])).rows[0]!).name).toBe("Site");
  });

  it("a user cannot create a project owned by someone else", async () => {
    const err = await fails(as(BOB, () => insertProject(ALICE)));
    expect(err.message).toMatch(/row-level security/i);
  });

  it("a user cannot hand their project to someone else", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    const err = await fails(as(ALICE, () => db.query(`update projects set owner_id = $1 where id = $2`, [BOB, id])));
    expect(err.message).toMatch(/row-level security/i);
  });

  it("anonymous visitors see nothing and cannot write", async () => {
    await as(ALICE, () => insertProject(ALICE));
    expect(await as(null, async () => (await db.query(`select id from projects`)).rows)).toEqual([]);
    await fails(as(null, () => insertProject(ALICE)));
  });
});

describe("projects: data constraints", () => {
  it("rejects documents that are not schema v2 with a pages array", async () => {
    await fails(as(ALICE, () => insertProject(ALICE, { schemaVersion: 1, pages: [] })));
    await fails(as(ALICE, () => insertProject(ALICE, { schemaVersion: 2, pages: "nope" })));
    await fails(as(ALICE, () => insertProject(ALICE, { hello: "world" })));
  });
  it("rejects documents over 5 MB", async () => {
    const big = { ...doc(), blob: "x".repeat(5 * 1024 * 1024 + 10) };
    const err = await fails(as(ALICE, () => insertProject(ALICE, big)));
    expect(err.message).toMatch(/projects_json_size/);
  });
  it("rejects empty names and unknown platforms", async () => {
    await fails(as(ALICE, () => db.query(`insert into projects (owner_id, name, platform, json) values ($1, '', 'web', $2)`, [ALICE, JSON.stringify(doc())])));
    await fails(as(ALICE, () => db.query(`insert into projects (owner_id, name, platform, json) values ($1, 'x', 'tv', $2)`, [ALICE, JSON.stringify(doc())])));
  });
});

describe("save_project: optimistic concurrency (spec section 13)", () => {
  const save = (user: string, id: string, base: number, json: unknown, name: string | null = null) =>
    as(user, async () => (await db.query<{ version: number }>(`select * from save_project($1, $2, $3::jsonb, $4)`, [id, base, JSON.stringify(json), name])).rows[0]!);

  it("saves against the current version and increments it", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    expect((await save(ALICE, id, 1, doc("v2"))).version).toBe(2);
    expect((await save(ALICE, id, 2, doc("v3"), "Named")).version).toBe(3);
    const row = (await db.query<{ name: string; version: number; json: { name: string } }>(`select name, version, json from projects where id = $1`, [id])).rows[0]!;
    expect(row).toMatchObject({ name: "Named", version: 3 });
    expect(row.json.name).toBe("v3");
  });

  it("a stale base version is a conflict (40001) and changes nothing", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    await save(ALICE, id, 1, doc("first"));
    const err = await fails(save(ALICE, id, 1, doc("stale")));
    expect(err.code).toBe("40001");
    expect(err.message).toMatch(/version_conflict/);
    expect(((await db.query<{ json: { name: string } }>(`select json from projects where id = $1`, [id])).rows[0]!).json.name).toBe("first");
  });

  it("two editors racing from the same version: exactly one wins", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    const results = await Promise.allSettled([save(ALICE, id, 1, doc("tab-A")), save(ALICE, id, 1, doc("tab-B"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("someone else's project looks like it does not exist (P0002), never a conflict", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    const err = await fails(save(BOB, id, 1, doc("hijack")));
    expect(err.code).toBe("P0002");
    expect(((await db.query<{ version: number }>(`select version from projects where id = $1`, [id])).rows[0]!).version).toBe(1);
  });

  it("invalid documents are rejected and the version does not advance", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    await fails(save(ALICE, id, 1, { schemaVersion: 99, pages: [] }));
    expect(((await db.query<{ version: number }>(`select version from projects where id = $1`, [id])).rows[0]!).version).toBe(1);
  });

  it("anonymous callers cannot execute it", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    await fails(as(null, () => db.query(`select * from save_project($1, 1, $2::jsonb)`, [id, JSON.stringify(doc())])));
  });
});

describe("version history", () => {
  const snap = (user: string, id: string, reason?: string) => as(user, () => db.query(`select snapshot_project($1, $2)`, [id, reason ?? "autosave"]));
  const save = (id: string, base: number, name: string) => as(ALICE, () => db.query(`select * from save_project($1, $2, $3::jsonb)`, [id, base, JSON.stringify(doc(name))]));

  it("snapshots the current state, once per version", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    await snap(ALICE, id, "first");
    await snap(ALICE, id, "again"); // same version: updated, not duplicated
    const rows = (await db.query<{ version: number; reason: string }>(`select version, reason from project_versions where project_id = $1`, [id])).rows;
    expect(rows).toEqual([{ version: 1, reason: "again" }]);
  });

  it("keeps only the newest 30 snapshots", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    for (let v = 1; v <= 33; v++) {
      await snap(ALICE, id, `v${v}`);
      await save(id, v, `n${v}`);
    }
    const rows = (await db.query<{ version: number }>(`select version from project_versions where project_id = $1 order by version`, [id])).rows;
    expect(rows).toHaveLength(30);
    expect(rows[0]!.version).toBe(4);
    expect(rows[29]!.version).toBe(33);
  });

  it("history is private to the owner, and snapshotting a foreign project fails", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    await snap(ALICE, id);
    expect(await as(BOB, async () => (await db.query(`select 1 from project_versions where project_id = $1`, [id])).rows)).toEqual([]);
    const err = await fails(snap(BOB, id));
    expect(err.code).toBe("P0002");
  });

  it("deleting a project deletes its history", async () => {
    const id = await as(ALICE, () => insertProject(ALICE));
    await snap(ALICE, id);
    await as(ALICE, () => db.query(`delete from projects where id = $1`, [id]));
    expect((await db.query(`select 1 from project_versions where project_id = $1`, [id])).rows).toHaveLength(0);
  });
});

describe("assets", () => {
  const hash = (c: string) => c.repeat(64);
  const insertAsset = (owner: string, id: string, h = hash("a"), key = `${owner}/${id}`) =>
    db.query(
      `insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ($1, $2, 'pic', 'webp', 'image/webp', 1000, 10, 10, $3, $4)`,
      [id, owner, h, key],
    );

  it("owner-scoped: others cannot see or write", async () => {
    await as(ALICE, () => insertAsset(ALICE, "asset_one"));
    expect(await as(BOB, async () => (await db.query(`select id from assets`)).rows)).toEqual([]);
    await fails(as(BOB, () => insertAsset(ALICE, "asset_two", hash("b"))));
  });
  it("the same bytes cannot be stored twice by one user, but two users may each have them", async () => {
    await as(ALICE, () => insertAsset(ALICE, "asset_dup1", hash("c")));
    expect((await fails(as(ALICE, () => insertAsset(ALICE, "asset_dup2", hash("c"))))).message).toMatch(/assets_owner_id_hash_key|unique/i);
    await as(BOB, () => insertAsset(BOB, "asset_bobdup", hash("c")));
  });
  it("validates metadata: kind, size, hash, id format, and a storage key inside the owner's folder", async () => {
    await fails(as(ALICE, () => insertAsset(ALICE, "asset_k1", hash("d"), `${BOB}/asset_k1`)));
    await fails(as(ALICE, () => insertAsset(ALICE, "BAD ID", hash("e"))));
    await fails(as(ALICE, () => insertAsset(ALICE, "asset_k2", "nothex")));
    await fails(as(ALICE, () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ('asset_svg', $1, 'x', 'svg', 'image/svg+xml', 10, 1, 1, $2, $3)`, [ALICE, hash("f"), `${ALICE}/asset_svg`])));
    await fails(as(ALICE, () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ('asset_big', $1, 'x', 'webp', 'image/webp', ${21 * 1024 * 1024}, 1, 1, $2, $3)`, [ALICE, hash("0"), `${ALICE}/asset_big`])));
  });
});

describe("storage bucket policies", () => {
  const put = (user: string, path: string) => as(user, () => db.query(`insert into storage.objects (bucket_id, name, owner) values ('assets', $1, $2)`, [path, user]));

  it("creates a private bucket restricted to images up to 20 MB", async () => {
    const b = (await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'assets'`)).rows[0]!;
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(20 * 1024 * 1024);
    expect(b.allowed_mime_types).toEqual(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  });
  it("users can write and read only inside their own folder", async () => {
    await put(ALICE, `${ALICE}/asset_s1`);
    await fails(put(ALICE, `${BOB}/asset_s2`)); // into someone else's folder
    await fails(put(ALICE, `asset_s3`)); // no folder at all
    expect(await as(ALICE, async () => (await db.query(`select name from storage.objects`)).rows.length)).toBeGreaterThan(0);
    expect(await as(BOB, async () => (await db.query(`select name from storage.objects where name like $1`, [`${ALICE}/%`])).rows)).toEqual([]);
  });
  it("users cannot delete or overwrite other people's files", async () => {
    await put(ALICE, `${ALICE}/asset_s4`);
    expect((await as(BOB, () => db.query(`delete from storage.objects where name = $1`, [`${ALICE}/asset_s4`]))).affectedRows).toBe(0);
    expect((await as(BOB, () => db.query(`update storage.objects set name = $1 where name = $2`, [`${BOB}/stolen`, `${ALICE}/asset_s4`]))).affectedRows).toBe(0);
  });
  it("anonymous visitors cannot read the private bucket", async () => {
    await put(ALICE, `${ALICE}/asset_s5`);
    expect(await as(null, async () => (await db.query(`select name from storage.objects`)).rows)).toEqual([]);
  });
});
