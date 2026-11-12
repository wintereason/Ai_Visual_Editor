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
const U = {
  alice: "00000000-0000-0000-0000-00000000000a",
  bob: "00000000-0000-0000-0000-00000000000b",
  carol: "00000000-0000-0000-0000-00000000000c",
  dave: "00000000-0000-0000-0000-00000000000d",
} as const;
type Who = keyof typeof U | "anon";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  for (const m of ["20250101000000_init.sql", "20250102000000_sites_forms_derived.sql", "20250103000000_ai_credits.sql", "20250104000000_quotas.sql", "20250105000000_payments.sql", "20250106000000_collaboration.sql"]) await db.exec(sql(m));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id, email) values ('${U.alice}', 'Alice@Example.com'), ('${U.bob}', 'bob@example.com'), ('${U.carol}', 'carol@example.com'), ('${U.dave}', 'dave@example.com')`);
});
afterAll(() => db.close());

async function as<T>(who: Who, fn: () => Promise<T>): Promise<T> {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub', '${U[who]}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
const fails = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e: any) { return String(e.message); } throw new Error("expected failure"); };
const doc = (extra: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 2, id: "p", name: "P", platform: "web", pages: [], ...extra });

let k = 0;
async function newProject(owner: "alice" | "bob" = "alice", json = doc()): Promise<string> {
  return as(owner, async () => (await db.query<{ id: string }>(`insert into projects (owner_id, name, platform, json) values ($1, $2, 'web', $3::jsonb) returning id`, [U[owner], `Project ${++k}`, json])).rows[0]!.id);
}
const share = (who: Who, p: string, email: string, role = "editor") => as(who, () => db.query(`select share_project($1, $2, $3)`, [p, email, role]));
const claim = (who: Who) => as(who, async () => (await db.query<{ n: number }>(`select claim_invites() n`)).rows[0]!.n);
const visible = (who: Who, p: string) => as(who, async () => (await db.query(`select id from projects where id = $1`, [p])).rows.length);
const role = (who: Who, p: string) => as(who, async () => (await db.query<{ r: string | null }>(`select project_role($1) r`, [p])).rows[0]!.r);
const save = (who: Who, p: string, base: number, json = doc({ name: "changed" })) => as(who, async () => (await db.query<{ version: number }>(`select * from save_project($1, $2, $3::jsonb)`, [p, base, json])).rows[0]!.version);
const people = (who: Who, p: string) => as(who, async () => (await db.query<any>(`select * from project_people($1)`, [p])).rows);
/** Alice shares with bob and bob accepts. */
async function sharedWithBob(r = "editor"): Promise<string> {
  const p = await newProject();
  await share("alice", p, "bob@example.com", r);
  await claim("bob");
  return p;
}

describe("sharing is an invitation first, and membership only after the invitee signs in", () => {
  it("an invitation gives no access by itself", async () => {
    const p = await newProject();
    await share("alice", p, "bob@example.com");
    expect(await visible("bob", p)).toBe(0);
    expect(await role("bob", p)).toBeNull();
    expect((await people("alice", p)).map((r) => [r.kind, r.email, r.role])).toEqual([["invited", "bob@example.com", "editor"]]);
  });

  it("claiming turns it into membership (email matching ignores case), and the invitation is used up", async () => {
    const p = await newProject();
    await share("alice", p, "  BOB@Example.com ", "viewer");
    expect(await claim("bob")).toBeGreaterThanOrEqual(1); // (also takes any other invitation still waiting for bob)
    expect(await role("bob", p)).toBe("viewer");
    expect(await visible("bob", p)).toBe(1);
    expect(await claim("bob")).toBe(0);
    expect((await people("alice", p)).map((r) => [r.kind, r.email, r.role])).toEqual([["member", "bob@example.com", "viewer"]]);
  });

  it("a different person can't claim someone else's invitation", async () => {
    const p = await newProject();
    await share("alice", p, "bob@example.com");
    expect(await claim("carol")).toBe(0);
    expect(await visible("carol", p)).toBe(0);
    expect(await visible("bob", p)).toBe(0); // and bob hasn't claimed yet
  });

  it("sharing with an email that has an account and one that doesn't look exactly the same, so accounts can't be probed", async () => {
    const p = await newProject();
    await share("alice", p, "carol@example.com"); // has an account
    await share("alice", p, "nobody-here@example.com"); // doesn't
    const rows = await people("alice", p);
    expect(rows.map((r) => r.kind)).toEqual(["invited", "invited"]);
    expect(rows.every((r) => r.user_id === null)).toBe(true);
  });

  it("invitations expire after 30 days", async () => {
    const p = await newProject();
    await share("alice", p, "dave@example.com");
    await db.exec(`update project_invites set created_at = now() - interval '31 days' where project_id = '${p}'`);
    expect(await claim("dave")).toBe(0);
    expect(await visible("dave", p)).toBe(0);
  });

  it("an invitation to the owner's own email never makes the owner a member of their own project", async () => {
    const p = await newProject();
    await db.exec(`insert into project_invites (project_id, email, role, invited_by) values ('${p}', 'alice@example.com', 'editor', '${U.alice}')`);
    expect(await claim("alice")).toBe(0);
    expect(await role("alice", p)).toBe("owner");
  });
});

describe("only the owner can share, and only sensibly", () => {
  it("a member, an editor, a stranger and an anonymous caller can't share", async () => {
    const p = await sharedWithBob("editor");
    expect(await fails(share("bob", p, "carol@example.com"))).toMatch(/not_owner/);
    expect(await fails(share("carol", p, "dave@example.com"))).toMatch(/not_owner/);
    await expect(as("anon", () => db.query(`select share_project($1,'x@y.zz','editor')`, [p]))).rejects.toThrow(/permission denied/);
  });
  it("refuses sharing with yourself, bad emails and bad roles", async () => {
    const p = await newProject();
    expect(await fails(share("alice", p, "alice@example.com"))).toMatch(/cannot_share_with_self/);
    for (const bad of ["", "nope", "a@b", "a b@c.de", "x".repeat(250) + "@example.com"]) expect(await fails(share("alice", p, bad)), bad).toMatch(/bad_email/);
    expect(await fails(share("alice", p, "carol@example.com", "owner"))).toMatch(/bad_role/);
    expect(await fails(share("alice", p, "carol@example.com", "admin"))).toMatch(/bad_role/);
  });
  it("at most 10 people per project; re-sharing with someone already there is not a new person", async () => {
    const p = await newProject();
    for (let i = 0; i < 10; i++) await share("alice", p, `person${i}@example.com`);
    expect(await fails(share("alice", p, "one-too-many@example.com"))).toMatch(/too_many_people/);
    await share("alice", p, "person3@example.com", "viewer"); // changes a role, doesn't add a person
    expect((await people("alice", p)).length).toBe(10);
  });
  it("re-sharing with a new role changes it once they next claim", async () => {
    const p = await sharedWithBob("editor");
    expect(await role("bob", p)).toBe("editor");
    await share("alice", p, "bob@example.com", "viewer");
    expect(await role("bob", p)).toBe("editor"); // nothing changes until the invitee accepts
    await claim("bob");
    expect(await role("bob", p)).toBe("viewer");
  });
  it("only the owner can see who has access", async () => {
    const p = await sharedWithBob();
    expect(await fails(people("bob", p))).toMatch(/not_owner/);
    expect(await fails(people("carol", p))).toMatch(/not_owner/);
    // and the tables themselves can't be read around the function
    expect(await as("carol", async () => (await db.query(`select * from project_members`)).rows.length)).toBe(0);
    expect(await as("carol", async () => (await db.query(`select * from project_invites`)).rows.length)).toBe(0);
    expect(await as("bob", async () => (await db.query(`select * from project_invites`)).rows.length)).toBe(0);
  });
});

describe("what a member can do", () => {
  it("a viewer can read but not save, with a clear reason, and nothing changes", async () => {
    const p = await sharedWithBob("viewer");
    expect(await visible("bob", p)).toBe(1);
    expect(await fails(save("bob", p, 1))).toMatch(/read_only/);
    const direct = await as("bob", () => db.query(`update projects set name = 'hacked' where id = $1 returning id`, [p]));
    expect(direct.rows.length).toBe(0);
    expect(await as("alice", async () => (await db.query<any>(`select name, version from projects where id = $1`, [p])).rows[0]!.version)).toBe(1);
  });

  it("an editor can save, and the optimistic-concurrency rule still protects against overwriting", async () => {
    const p = await sharedWithBob("editor");
    expect(await save("bob", p, 1)).toBe(2);
    expect(await fails(save("alice", p, 1))).toMatch(/version_conflict/); // alice was still on version 1
    expect(await save("alice", p, 2)).toBe(3);
    expect(await fails(save("bob", p, 2))).toMatch(/version_conflict/);
  });

  it("a stranger saving a project they have no access to just sees 'not found'", async () => {
    const p = await newProject();
    expect(await fails(save("carol", p, 1))).toMatch(/not_found/);
  });

  it("an editor can't take the project over, rename its owner, delete it, or reach its publishing and inbox", async () => {
    const p = await sharedWithBob("editor");
    await expect(as("bob", () => db.query(`update projects set owner_id = $1 where id = $2`, [U.bob, p]))).rejects.toThrow();
    const del = await as("bob", () => db.query(`delete from projects where id = $1 returning id`, [p]));
    expect(del.rows.length).toBe(0);
    expect(await visible("alice", p)).toBe(1);
    expect(await fails(as("bob", () => db.query(`select unshare_project($1, $2)`, [p, U.alice])))).toMatch(/not_owner/);
    expect(await as("bob", async () => (await db.query(`select * from sites where project_id = $1`, [p])).rows.length)).toBe(0);
  });

  it("editors can take version snapshots (history stays owned by the project owner); viewers can read history but not write it", async () => {
    const p = await sharedWithBob("editor");
    await as("bob", () => db.query(`select snapshot_project($1, 'bob checkpoint')`, [p]));
    const v = await as("alice", async () => (await db.query<any>(`select owner_id, reason from project_versions where project_id = $1`, [p])).rows);
    expect(v).toEqual([{ owner_id: U.alice, reason: "bob checkpoint" }]);
    const q = await sharedWithBob("viewer");
    await as("alice", () => db.query(`select snapshot_project($1, 'a')`, [q]));
    expect(await as("bob", async () => (await db.query(`select id from project_versions where project_id = $1`, [q])).rows.length)).toBe(1);
    await expect(as("bob", () => db.query(`select snapshot_project($1, 'x')`, [q]))).rejects.toThrow();
  });

  it("shared projects are listed for the person they were shared with, with the owner and role", async () => {
    const p = await sharedWithBob("viewer");
    const rows = await as("bob", async () => (await db.query<any>(`select * from shared_with_me()`)).rows);
    const mine = rows.find((r) => r.id === p);
    expect(mine).toMatchObject({ role: "viewer", owner_email: "Alice@Example.com" });
    expect(await as("carol", async () => (await db.query(`select * from shared_with_me()`)).rows.length)).toBe(0);
  });

  it("a stranger sees none of it", async () => {
    const p = await sharedWithBob();
    expect(await visible("carol", p)).toBe(0);
    expect(await role("carol", p)).toBeNull();
  });
});

describe("removing access", () => {
  it("the owner can remove a member (access ends at once) or a pending invitation", async () => {
    const p = await sharedWithBob();
    await as("alice", () => db.query(`select unshare_project($1, $2)`, [p, U.bob]));
    expect(await visible("bob", p)).toBe(0);
    await share("alice", p, "carol@example.com");
    await as("alice", () => db.query(`select unshare_project($1, null, 'Carol@example.com')`, [p]));
    await claim("carol");
    expect(await role("carol", p)).toBeNull(); // the withdrawn invitation can no longer be claimed
  });
  it("a member can leave; leaving someone else's membership does nothing", async () => {
    const p = await sharedWithBob();
    await share("alice", p, "carol@example.com");
    await claim("carol");
    await as("carol", () => db.query(`select leave_project($1)`, [p]));
    expect(await visible("carol", p)).toBe(0);
    expect(await visible("bob", p)).toBe(1);
  });
  it("deleting the project, or a person's account, cleans up its sharing records", async () => {
    const p = await sharedWithBob();
    await as("alice", () => db.query(`delete from projects where id = $1`, [p]));
    expect((await db.query(`select 1 from project_members where project_id = $1`, [p])).rows.length).toBe(0);
    const q = await sharedWithBob();
    await db.exec(`delete from auth.users where id = '${U.bob}'`);
    expect((await db.query(`select 1 from project_members where project_id = $1`, [q])).rows.length).toBe(0);
    await db.exec(`insert into auth.users (id, email) values ('${U.bob}', 'bob@example.com')`); // restore for later tests
  });
});

describe("pictures follow the project", () => {
  const asset = (id: string, owner: "alice" | "bob", hash: string) =>
    as(owner, () => db.query(`insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key) values ($1,$2,'pic','png','image/png',10,1,1,$3,$4)`, [id, U[owner], hash.repeat(64).slice(0, 64), `${U[owner]}/${id}`]));
  const file = (owner: "alice" | "bob", id: string) => db.query(`insert into storage.objects (bucket_id, name) values ('assets', $1)`, [`${U[owner]}/${id}`]);
  const seesAsset = (who: Who, id: string) => as(who, async () => (await db.query(`select id from assets where id = $1`, [id])).rows.length);
  const seesFile = (who: Who, owner: "alice" | "bob", id: string) => as(who, async () => (await db.query(`select id from storage.objects where bucket_id = 'assets' and name = $1`, [`${U[owner]}/${id}`])).rows.length);

  it("a member sees the pictures the project uses, and only those", async () => {
    await asset("asset_used1", "alice", "a");
    await asset("asset_unused1", "alice", "b");
    await file("alice", "asset_used1"); await file("alice", "asset_unused1");
    const p = await newProject("alice", doc({ pages: [{ id: "pg", name: "Home", path: "/", nodes: [{ id: "i", props: { assetId: "asset_used1" } }] }] }));
    await share("alice", p, "bob@example.com"); await claim("bob");
    expect(await seesAsset("bob", "asset_used1")).toBe(1);
    expect(await seesFile("bob", "alice", "asset_used1")).toBe(1);
    expect(await seesAsset("bob", "asset_unused1")).toBe(0);
    expect(await seesFile("bob", "alice", "asset_unused1")).toBe(0);
    expect(await seesAsset("carol", "asset_used1")).toBe(0);
    expect(await seesFile("carol", "alice", "asset_used1")).toBe(0);
  });

  it("a collaborator's own upload becomes visible to the owner once the project uses it, and not before", async () => {
    const p = await newProject("alice");
    await share("alice", p, "bob@example.com"); await claim("bob");
    await asset("asset_bobpic1", "bob", "c"); await file("bob", "asset_bobpic1");
    expect(await seesAsset("alice", "asset_bobpic1")).toBe(0);
    await save("bob", p, 1, doc({ pages: [{ id: "pg", name: "Home", path: "/", nodes: [{ id: "i", props: { assetId: "asset_bobpic1" } }] }] }));
    expect(await seesAsset("alice", "asset_bobpic1")).toBe(1);
    expect(await seesFile("alice", "bob", "asset_bobpic1")).toBe(1);
  });

  it("members can read those pictures but can never change or delete someone else's", async () => {
    await asset("asset_used2", "alice", "d");
    const p = await newProject("alice", doc({ pages: [{ id: "pg", name: "Home", path: "/", nodes: [{ id: "i", props: { assetId: "asset_used2" } }] }] }));
    await share("alice", p, "bob@example.com"); await claim("bob");
    const upd = await as("bob", () => db.query(`update assets set name = 'x' where id = 'asset_used2' returning id`));
    const del = await as("bob", () => db.query(`delete from assets where id = 'asset_used2' returning id`));
    expect(upd.rows.length + del.rows.length).toBe(0);
    await file("alice", "asset_used2");
    const rm = await as("bob", () => db.query(`delete from storage.objects where name = $1 returning id`, [`${U.alice}/asset_used2`]));
    expect(rm.rows.length).toBe(0);
  });

  it("naming someone else's picture id inside your own project grants nothing", async () => {
    await asset("asset_private1", "alice", "e");
    await file("alice", "asset_private1");
    const mine = await newProject("bob", doc({ pages: [{ id: "pg", name: "Home", path: "/", nodes: [{ id: "i", props: { assetId: "asset_private1" } }] }] }));
    void mine;
    // bob's own project names alice's picture id. Alice is not part of bob's project, so that grants bob nothing.
    expect(await seesAsset("bob", "asset_private1")).toBe(0);
    expect(await seesFile("bob", "alice", "asset_private1")).toBe(0);
    expect(await seesAsset("carol", "asset_private1")).toBe(0);
  });
});

describe("the new functions are for signed-in people only", () => {
  it("anonymous callers are refused everywhere", async () => {
    for (const call of ["select project_role(gen_random_uuid())", "select claim_invites()", "select shared_with_me()", "select leave_project(gen_random_uuid())", "select * from project_people(gen_random_uuid())", "select unshare_project(gen_random_uuid())"]) {
      await expect(as("anon", () => db.query(call)), call).rejects.toThrow(/permission denied/);
    }
    for (const t of ["project_members", "project_invites"]) expect(await as("anon", async () => (await db.query(`select * from ${t}`)).rows.length), t).toBe(0);
  });
});
