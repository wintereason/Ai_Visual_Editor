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
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
  grant usage on schema public, auth, storage to anon, authenticated;
`;
// Supabase grants these by default; RLS (and the absence of grants/policies) is what restricts access.
const GRANTS = `
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to anon;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets, storage.objects to anon;
`;

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(sql("20250101000000_init.sql"));
  await db.exec(sql("20250102000000_sites_forms_derived.sql"));
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
});
afterAll(() => db.close());

async function as<T>(user: string | null, fn: () => Promise<T>, headers?: Record<string, string>): Promise<T> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)` : `set role anon`);
  if (headers) await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false)`);
  }
}
const fails = async (p: Promise<unknown>): Promise<{ code?: string; message: string }> => {
  try { await p; } catch (e: any) { return { code: e.code, message: String(e.message) }; }
  throw new Error("expected the statement to fail, but it succeeded");
};

const doc = { schemaVersion: 2, id: "p", name: "Site", platform: "web", pages: [] };
const project = async (owner: string) => (await db.query<{ id: string }>(`insert into projects (owner_id, name, platform, json) values ($1, 'S', 'web', $2) returning id`, [owner, JSON.stringify(doc)])).rows[0]!.id;
let seq = 0;
const site = async (owner: string, extra = "") => {
  const slug = `site-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
  const pid = await project(owner);
  const id = (await db.query<{ id: string }>(`insert into sites (owner_id, project_id, slug${extra ? ", notify_email" : ""}) values ($1, $2, $3${extra ? ", $4" : ""}) returning id`, extra ? [owner, pid, slug, extra] : [owner, pid, slug])).rows[0]!.id;
  return { id, slug, pid };
};
const submit = (slug: string, fields: unknown = { name: "Asha", message: "Hello" }, form = "contact", honeypot: string | null = null, headers?: Record<string, string>) =>
  as(null, async () => (await db.query<{ submit_form: { ok: boolean } }>(`select submit_form($1, $2, $3::jsonb, $4)`, [slug, form, JSON.stringify(fields), honeypot])).rows[0]!.submit_form, headers);
const count = async (siteId: string) => Number((await db.query<{ n: string }>(`select count(*) n from form_submissions where site_id = $1`, [siteId])).rows[0]!.n);

describe("assets: derived-image metadata", () => {
  const ins = (owner: string, id: string, from: string | null, op: string | null, hash: string) =>
    db.query(
      `insert into assets (id, owner_id, name, kind, mime, bytes, width, height, hash, storage_key, derived_from_asset, derived_op) values ($1, $2, 'x', 'webp', 'image/webp', 10, 1, 1, $3, $4, $5, $6)`,
      [id, owner, hash, `${owner}/${id}`, from, op],
    );
  it("accepts an original (both null) and a derived file (both set)", async () => {
    await as(ALICE, () => ins(ALICE, "asset_orig", null, null, "a".repeat(64)));
    await as(ALICE, () => ins(ALICE, "asset_rot", "asset_orig", "rotate", "b".repeat(64)));
    await as(ALICE, () => ins(ALICE, "asset_crop", "asset_orig", "crop", "c".repeat(64)));
  });
  it("rejects half-set pairs, unknown operations and malformed source ids", async () => {
    await fails(as(ALICE, () => ins(ALICE, "asset_h1", "asset_orig", null, "d".repeat(64))));
    await fails(as(ALICE, () => ins(ALICE, "asset_h2", null, "rotate", "e".repeat(64))));
    await fails(as(ALICE, () => ins(ALICE, "asset_h3", "asset_orig", "blur", "f".repeat(64))));
    await fails(as(ALICE, () => ins(ALICE, "asset_h4", "BAD ID; drop table x", "crop", "1".repeat(64))));
  });
});

describe("sites", () => {
  it("an owner can create and read their site; others cannot see it", async () => {
    const s = await as(ALICE, () => site(ALICE));
    expect(await as(ALICE, async () => (await db.query(`select id from sites where id = $1`, [s.id])).rows)).toHaveLength(1);
    expect(await as(BOB, async () => (await db.query(`select id from sites where id = $1`, [s.id])).rows)).toEqual([]);
    expect(await as(null, async () => (await db.query(`select id from sites`)).rows)).toEqual([]);
  });
  it("cannot create a site as someone else, or attach a site to someone else's project", async () => {
    const pid = await project(ALICE);
    // claiming to be the owner
    await fails(as(BOB, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, 'steal-it')`, [ALICE, pid])));
    // honest owner_id, but the project is Alice's: this used to slip through and would block Alice from ever publishing it
    const err = await fails(as(BOB, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, 'squat-it')`, [BOB, pid])));
    expect(err.message).toMatch(/row-level security/i);
    expect((await db.query(`select 1 from sites where project_id = $1`, [pid])).rows).toHaveLength(0);
    // Alice can still publish her own project
    await as(ALICE, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, 'alice-real')`, [ALICE, pid]));
  });
  it("a site cannot be re-pointed at someone else's project by updating it", async () => {
    const mine = await as(BOB, () => site(BOB));
    const theirs = await project(ALICE);
    await fails(as(BOB, () => db.query(`update sites set project_id = $1 where id = $2`, [theirs, mine.id])));
  });
  it("validates slugs: lowercase letters, digits and inner hyphens only, 3-40 characters", async () => {
    for (const bad of ["Ab-cd", "a", "ab", "-abc", "abc-", "has space", "under_score", "dot.dot", "a".repeat(41), "../etc", "x'; drop table sites;--"]) {
      const pid = await project(ALICE);
      await fails(as(ALICE, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, $3)`, [ALICE, pid, bad])));
    }
    for (const good of ["abc", "my-school-2025", "a1b"]) {
      const pid = await project(ALICE);
      await as(ALICE, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, $3)`, [ALICE, pid, good]));
    }
  });
  it("slugs are unique and a project has at most one site", async () => {
    const s = await as(ALICE, () => site(ALICE));
    const pid = await project(BOB);
    await fails(as(BOB, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, $3)`, [BOB, pid, s.slug])));
    await fails(as(ALICE, () => db.query(`insert into sites (owner_id, project_id, slug) values ($1, $2, 'another-slug')`, [ALICE, s.pid])));
  });
  it("validates the notification email", async () => {
    await as(ALICE, () => site(ALICE, "owner@example.com"));
    for (const bad of ["nope", "a@b", "a b@c.de", "x@y.z".padEnd(300, "z")]) await fails(as(ALICE, () => site(ALICE, bad)));
  });
  it("deleting the project deletes the site and its submissions", async () => {
    const s = await as(ALICE, () => site(ALICE));
    await submit(s.slug);
    expect(await count(s.id)).toBe(1);
    await as(ALICE, () => db.query(`delete from projects where id = $1`, [s.pid]));
    expect(await count(s.id)).toBe(0);
  });
});

describe("submit_form: what visitors can send", () => {
  it("stores a valid submission, and an anonymous visitor can do it", async () => {
    const s = await as(ALICE, () => site(ALICE));
    expect(await submit(s.slug, { name: "Asha", email: "asha@example.com", message: "Hi there" })).toEqual({ ok: true });
    const row = (await db.query<{ payload: Record<string, string>; form_id: string }>(`select payload, form_id from form_submissions where site_id = $1`, [s.id])).rows[0]!;
    expect(row.payload).toEqual({ name: "Asha", email: "asha@example.com", message: "Hi there" });
    expect(row.form_id).toBe("contact");
  });

  it("unicode and markup are stored as plain data (escaping is the renderer's job), and SQL-looking text is inert", async () => {
    const s = await as(ALICE, () => site(ALICE));
    const nasty = { name: "राहुल <script>alert(1)</script>", message: "'); drop table form_submissions; --" };
    await submit(s.slug, nasty);
    expect(((await db.query<{ payload: unknown }>(`select payload from form_submissions where site_id = $1`, [s.id])).rows[0]!).payload).toEqual(nasty);
    expect((await db.query(`select 1 from form_submissions`)).rows.length).toBeGreaterThan(0); // the table is still there
  });

  it("a filled honeypot looks like success to the bot but stores nothing", async () => {
    const s = await as(ALICE, () => site(ALICE));
    expect(await submit(s.slug, { name: "Bot" }, "contact", "http://spam.example")).toEqual({ ok: true });
    expect(await count(s.id)).toBe(0);
    expect(await submit(s.slug, { name: "Human" }, "contact", "   ")).toEqual({ ok: true }); // whitespace-only is not a filled honeypot
    expect(await count(s.id)).toBe(1);
  });

  it("rejects malformed submissions", async () => {
    const s = await as(ALICE, () => site(ALICE));
    const bad: [string, unknown, string?][] = [
      ["array instead of object", ["a", "b"]],
      ["string instead of object", "hello"],
      ["no fields", {}],
      ["number value", { age: 7 }],
      ["object value", { a: { b: "c" } }],
      ["array value", { a: ["x"] }],
      ["null value", { a: null }],
      ["boolean value", { a: true }],
      ["bad field name", { "na;me": "x" }],
      ["empty field name", { "": "x" }],
      ["long field name", { ["n".repeat(65)]: "x" }],
      ["value over 2000 chars", { a: "x".repeat(2001) }],
      ["21 fields", Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, "x"]))],
      ["total over 8000 chars", Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, "x".repeat(1900)]))],
      ["bad form id", { a: "x" }, "bad form!"],
      ["empty form id", { a: "x" }, ""],
      ["long form id", { a: "x" }, "f".repeat(65)],
    ];
    for (const [why, fields, form] of bad) {
      const err = await fails(submit(s.slug, fields, form ?? "contact"));
      expect(err.code, why).toBe("22023");
    }
    expect(await count(s.id)).toBe(0);
  });

  it("accepts the limits exactly: 20 fields, 2000-character values, 8000 total", async () => {
    const s = await as(ALICE, () => site(ALICE));
    await submit(s.slug, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, "x"])));
    await submit(s.slug, { a: "x".repeat(2000), b: "y".repeat(2000), c: "z".repeat(2000), d: "w".repeat(2000) });
    expect(await count(s.id)).toBe(2);
  });

  it("unknown sites, forms-disabled sites and injection-shaped slugs all look the same: not found", async () => {
    const s = await as(ALICE, () => site(ALICE));
    expect((await fails(submit("no-such-site"))).code).toBe("P0002");
    expect((await fails(submit("x' or '1'='1"))).code).toBe("P0002");
    await as(ALICE, () => db.query(`update sites set forms_enabled = false where id = $1`, [s.id]));
    expect((await fails(submit(s.slug))).code).toBe("P0002");
    await as(ALICE, () => db.query(`update sites set forms_enabled = true where id = $1`, [s.id]));
    await submit(s.slug);
    expect(await count(s.id)).toBe(1);
  });
});

describe("submit_form: abuse limits", () => {
  it("one visitor can send 5 messages in 10 minutes; the 6th is rate limited; another visitor is unaffected", async () => {
    const s = await as(ALICE, () => site(ALICE));
    const ip = (a: string) => ({ "x-forwarded-for": a });
    for (let i = 0; i < 5; i++) await submit(s.slug, { n: String(i) }, "contact", null, ip("203.0.113.7"));
    const err = await fails(submit(s.slug, { n: "6" }, "contact", null, ip("203.0.113.7")));
    expect(err.code).toBe("R0429");
    await submit(s.slug, { n: "other" }, "contact", null, ip("198.51.100.9"));
    expect(await count(s.id)).toBe(6);
  });
  it("the first address in a proxy chain is the visitor", async () => {
    const s = await as(ALICE, () => site(ALICE));
    for (let i = 0; i < 5; i++) await submit(s.slug, { n: String(i) }, "contact", null, { "x-forwarded-for": "203.0.113.50, 10.0.0.1, 10.0.0.2" });
    expect((await fails(submit(s.slug, { n: "x" }, "contact", null, { "x-forwarded-for": "203.0.113.50, 10.9.9.9" }))).code).toBe("R0429");
  });
  it("the raw address is never stored, only a per-site salted hash", async () => {
    const a = await as(ALICE, () => site(ALICE));
    const b = await as(ALICE, () => site(ALICE));
    await submit(a.slug, { n: "1" }, "contact", null, { "x-forwarded-for": "203.0.113.77" });
    await submit(b.slug, { n: "1" }, "contact", null, { "x-forwarded-for": "203.0.113.77" });
    const rows = (await db.query<{ sender_hash: string; payload: unknown }>(`select sender_hash, payload from form_submissions where site_id in ($1, $2)`, [a.id, b.id])).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.sender_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain("203.0.113.77");
    }
    expect(rows[0]!.sender_hash).not.toBe(rows[1]!.sender_hash); // unlinkable across sites
  });
  it("without an address header only the site-wide limit applies (no shared bucket for everyone)", async () => {
    const s = await as(ALICE, () => site(ALICE));
    for (let i = 0; i < 8; i++) await submit(s.slug, { n: String(i) }); // more than the per-visitor limit, no header
    expect(await count(s.id)).toBe(8);
  });
  it("a flood on one site is capped at 30 per minute and does not block other sites", async () => {
    const a = await as(ALICE, () => site(ALICE));
    const b = await as(ALICE, () => site(ALICE));
    await db.query(`insert into form_submissions (site_id, form_id, payload) select $1, 'contact', '{"a":"x"}'::jsonb from generate_series(1, 30)`, [a.id]);
    expect((await fails(submit(a.slug))).code).toBe("R0429");
    await submit(b.slug);
    expect(await count(b.id)).toBe(1);
  });
  it("old submissions don't count: the limit window slides", async () => {
    const s = await as(ALICE, () => site(ALICE));
    const h = "203.0.113.200";
    for (let i = 0; i < 5; i++) await submit(s.slug, { n: String(i) }, "contact", null, { "x-forwarded-for": h });
    await db.query(`update form_submissions set created_at = now() - interval '11 minutes' where site_id = $1`, [s.id]);
    await submit(s.slug, { n: "again" }, "contact", null, { "x-forwarded-for": h });
    expect(await count(s.id)).toBe(6);
  });
});

describe("form submissions: who can read them", () => {
  it("anonymous visitors cannot read, insert, update or delete submissions directly", async () => {
    const s = await as(ALICE, () => site(ALICE));
    await submit(s.slug);
    expect(await as(null, async () => (await db.query(`select * from form_submissions`)).rows)).toEqual([]);
    await fails(as(null, () => db.query(`insert into form_submissions (site_id, form_id, payload) values ($1, 'x', '{"a":"b"}')`, [s.id])));
    expect((await as(null, () => db.query(`update form_submissions set form_id = 'hacked'`))).affectedRows).toBe(0);
    expect((await as(null, () => db.query(`delete from form_submissions`))).affectedRows).toBe(0);
    expect(await count(s.id)).toBe(1);
  });
  it("the site owner reads and deletes only their own sites' submissions", async () => {
    const a = await as(ALICE, () => site(ALICE));
    const b = await as(BOB, () => site(BOB));
    await submit(a.slug, { who: "for alice" });
    await submit(b.slug, { who: "for bob" });
    const seen = (user: string) => as(user, async () => (await db.query<{ payload: { who?: string } }>(`select payload from form_submissions`)).rows.map((r) => r.payload.who));
    const alice = await seen(ALICE); // Alice owns many sites in these tests, so look for what she must and must not see
    expect(alice).toContain("for alice");
    expect(alice).not.toContain("for bob");
    expect(await seen(BOB)).toEqual(["for bob"]);

    expect((await as(BOB, () => db.query(`delete from form_submissions where site_id = $1`, [a.id]))).affectedRows).toBe(0);
    expect(await count(a.id)).toBe(1);
    expect((await as(ALICE, () => db.query(`delete from form_submissions where site_id = $1`, [a.id]))).affectedRows).toBe(1);
  });
  it("signed-in users cannot insert or edit submissions directly either (only via the function)", async () => {
    const s = await as(ALICE, () => site(ALICE));
    await fails(as(ALICE, () => db.query(`insert into form_submissions (site_id, form_id, payload) values ($1, 'x', '{"a":"b"}')`, [s.id])));
    await submit(s.slug);
    expect((await as(ALICE, () => db.query(`update form_submissions set payload = '{"a":"forged"}' where site_id = $1`, [s.id]))).affectedRows).toBe(0);
  });
  it("the table itself enforces shape even if the function were bypassed (superuser insert)", async () => {
    const s = await as(ALICE, () => site(ALICE));
    await fails(db.query(`insert into form_submissions (site_id, form_id, payload) values ($1, 'ok', '[1,2]')`, [s.id]));
    await fails(db.query(`insert into form_submissions (site_id, form_id, payload) values ($1, 'bad id!', '{"a":"b"}')`, [s.id]));
    await fails(db.query(`insert into form_submissions (site_id, form_id, payload) values ($1, 'ok', $2)`, [s.id, JSON.stringify({ a: "x".repeat(16100) })]));
  });
});

describe("earlier protections still hold after migration 2", () => {
  it("anonymous callers still cannot run save_project / snapshot_project, and still see no projects", async () => {
    const pid = await project(ALICE);
    await fails(as(null, () => db.query(`select * from save_project($1, 1, $2::jsonb)`, [pid, JSON.stringify(doc)])));
    await fails(as(null, () => db.query(`select snapshot_project($1)`, [pid])));
    expect(await as(null, async () => (await db.query(`select id from projects`)).rows)).toEqual([]);
  });
});
