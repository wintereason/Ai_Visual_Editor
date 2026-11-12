import { describe, expect, it } from "vitest";
import { exampleProject, type Asset, type Project } from "@avc/schema";
import { CloudError, ConflictError, NotFoundError, createMemoryAdapter, createSupabaseAdapter, mapError, type CloudAdapter, type KV } from "../src";

const memKv = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const proj = (name = "Site"): Project => ({ ...structuredClone(exampleProject), name });
const asset = (id: string, hash = id.padEnd(64, "0")): Asset => ({ id, name: id, kind: "webp", mime: "image/webp", bytes: 3, width: 1, height: 1, hash, createdAt: 1 });
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });

/** Two "browser tabs / devices" sharing one server (same KV), as different or the same user. */
async function pair(a = "alice@example.com", b = "alice@example.com") {
  const kv = memKv();
  const A = createMemoryAdapter(kv);
  const B = createMemoryAdapter(kv);
  await A.signInWithEmail(a);
  if (b !== a) await A.signOut();
  await B.signInWithEmail(b);
  return { A, B, kv };
}

describe("memory adapter: the contract the editor relies on", () => {
  it("requires sign-in, validates the email", async () => {
    const a = createMemoryAdapter(memKv());
    await expect(a.listProjects()).rejects.toThrow(CloudError);
    await expect(a.signInWithEmail("nope")).rejects.toThrow(/valid email/);
    await a.signInWithEmail("x@y.co");
    expect((await a.user())?.email).toBe("x@y.co");
    await a.signOut();
    expect(await a.user()).toBeNull();
  });

  it("notifies auth listeners and stops after unsubscribe", async () => {
    const a = createMemoryAdapter(memKv());
    const seen: (string | null)[] = [];
    const off = a.onAuthChange((u) => seen.push(u?.email ?? null));
    await a.signInWithEmail("x@y.co");
    await a.signOut();
    off();
    await a.signInWithEmail("x@y.co");
    expect(seen).toEqual(["x@y.co", null]);
  });

  it("create / list / load / delete round-trips a project", async () => {
    const { A } = await pair();
    const { id, version } = await A.createProject(proj("One"));
    expect(version).toBe(1);
    expect((await A.listProjects()).map((p) => p.name)).toEqual(["One"]);
    const loaded = await A.loadProject(id);
    expect(loaded.project.name).toBe("One");
    await A.deleteProject(id);
    expect(await A.listProjects()).toEqual([]);
    await expect(A.loadProject(id)).rejects.toThrow(NotFoundError);
  });

  it("saves against the current version; a stale base is a ConflictError that changes nothing", async () => {
    const { A, B } = await pair();
    const { id } = await A.createProject(proj("v1"));
    expect((await A.saveProject(id, 1, proj("from A"))).version).toBe(2);
    await expect(B.saveProject(id, 1, proj("from B (stale)"))).rejects.toThrow(ConflictError);
    expect((await B.loadProject(id)).project.name).toBe("from A");
    expect((await B.saveProject(id, 2, proj("B rebased"))).version).toBe(3);
  });

  it("other users cannot see, load, save or delete it", async () => {
    const { A, B } = await pair("alice@example.com", "bob@example.com");
    expect(await B.listProjects()).toEqual([]);
    await B.signOut();
    await A.signInWithEmail("alice@example.com");
    const { id } = await A.createProject(proj());
    await A.signOut();
    await B.signInWithEmail("bob@example.com");
    await expect(B.loadProject(id)).rejects.toThrow(NotFoundError);
    await expect(B.saveProject(id, 1, proj("hijack"))).rejects.toThrow(NotFoundError);
    await B.deleteProject(id); // silently does nothing, like RLS
    await B.signOut();
    await A.signInWithEmail("alice@example.com");
    expect((await A.loadProject(id)).project.name).toBe("Site");
  });

  it("rejects invalid project data on create and save", async () => {
    const { A } = await pair();
    const bad = { ...proj(), pages: "nope" } as unknown as Project;
    await expect(A.createProject(bad)).rejects.toThrow(CloudError);
    const { id } = await A.createProject(proj());
    await expect(A.saveProject(id, 1, bad)).rejects.toThrow(CloudError);
    expect((await A.loadProject(id)).version).toBe(1);
  });

  it("history: one snapshot per version, newest 30 kept, restorable", async () => {
    const { A } = await pair();
    const { id } = await A.createProject(proj("n0"));
    for (let v = 1; v <= 33; v++) {
      await A.snapshot(id, `s${v}`);
      await A.saveProject(id, v, proj(`n${v}`));
    }
    const versions = await A.listVersions(id);
    expect(versions).toHaveLength(30);
    expect(Math.min(...versions.map((v) => v.version))).toBe(4);
    const oldest = versions.find((v) => v.version === 4)!;
    expect((await A.loadVersion(id, oldest.id)).name).toBe("n3");
    await A.snapshot(id, "again");
    expect((await A.listVersions(id)).filter((v) => v.version === 34)).toHaveLength(1);
  });

  it("assets: idempotent upload, round-trip bytes, per-user, delete", async () => {
    const { A, B } = await pair();
    const a = asset("asset_one");
    await A.uploadAsset(a, blob());
    await A.uploadAsset(a, blob()); // same id again: fine
    await A.uploadAsset(asset("asset_two", a.hash), blob()); // same bytes under another id: treated as already stored
    expect((await A.listAssets()).map((x) => x.id)).toEqual(["asset_one"]);
    const back = await B.downloadAsset(a);
    expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(back.type).toBe("image/webp");
    await A.deleteAsset("asset_one");
    expect(await A.listAssets()).toEqual([]);
    await expect(A.downloadAsset(a)).rejects.toThrow(NotFoundError);
  });
});

// ---------------- Supabase adapter, against a scripted client ----------------

type Reply = { data?: unknown; error?: { code?: string; message?: string; statusCode?: string } | null };
function fakeClient(script: Record<string, Reply[] | Reply>, session: { user: { id: string; email: string } } | null = { user: { id: "u1", email: "a@b.co" } }) {
  const calls: { target: string; ops: [string, unknown[]][] }[] = [];
  const next = (key: string): Reply => {
    const s = script[key];
    const r = Array.isArray(s) ? s.shift() : s;
    return { data: null, error: null, ...(r ?? {}) };
  };
  const chain = (key: string) => {
    const rec = { target: key, ops: [] as [string, unknown[]][] };
    calls.push(rec);
    const p: any = new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === "then") return (res: (v: Reply) => void) => res(next(key));
        return (...args: unknown[]) => (rec.ops.push([prop, args]), p);
      },
    });
    return p;
  };
  const client: any = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithOtp: async (args: unknown) => (calls.push({ target: "otp", ops: [["args", [args]]] }), next("otp")),
      signOut: async () => next("signOut"),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (t: string) => chain(`from:${t}`),
    rpc: (fn: string, args: unknown) => (calls.push({ target: `rpc:${fn}`, ops: [["args", [args]]] }), Promise.resolve(next(`rpc:${fn}`))),
    storage: {
      from: () => ({
        upload: async () => next("storage:upload"),
        download: async () => next("storage:download"),
        remove: async () => next("storage:remove"),
      }),
    },
  };
  return { adapter: createSupabaseAdapter(client), calls };
}

describe("access tokens", () => {
  it("memory: a token exists only while signed in", async () => {
    const a = createMemoryAdapter(memKv());
    expect(await a.accessToken()).toBeNull();
    await a.signInWithEmail("x@y.co");
    expect(await a.accessToken()).toMatch(/^mock\./);
    await a.signOut();
    expect(await a.accessToken()).toBeNull();
  });
  it("supabase: returns the session's access token, or null without a session", async () => {
    expect(await fakeClient({}, { user: { id: "u1", email: "a@b.co" }, access_token: "JWT.TOKEN.HERE" } as never).adapter.accessToken()).toBe("JWT.TOKEN.HERE");
    expect(await fakeClient({}, null).adapter.accessToken()).toBeNull();
  });
});

describe("memory adapter: asset descriptions", () => {
  it("updates the alt text, enforces the length limit, and is scoped to the owner", async () => {
    const { A, B } = await pair("alice@example.com", "bob@example.com");
    await A.signOut();
    await A.signInWithEmail("alice@example.com");
    await A.uploadAsset(asset("asset_alt"), blob());
    await A.updateAssetAlt("asset_alt", "A school gate");
    expect((await A.listAssets())[0]!.alt).toBe("A school gate");
    await expect(A.updateAssetAlt("asset_alt", "x".repeat(301))).rejects.toThrow(/too long/);
    await expect(A.updateAssetAlt("asset_missing", "x")).rejects.toThrow(NotFoundError);
    await B.signOut();
    await B.signInWithEmail("bob@example.com");
    await expect(B.updateAssetAlt("asset_alt", "hijack")).rejects.toThrow(NotFoundError);
    await A.signOut();
    await A.signInWithEmail("alice@example.com");
    expect((await A.listAssets())[0]!.alt).toBe("A school gate");
  });
  it("derived-image metadata is preserved", async () => {
    const { A } = await pair();
    await A.uploadAsset({ ...asset("asset_child"), derivedFrom: { assetId: "asset_parent", op: "crop" } }, blob());
    expect((await A.listAssets())[0]!.derivedFrom).toEqual({ assetId: "asset_parent", op: "crop" });
  });
});

describe("supabase adapter: alt text and derived images", () => {
  it("updateAssetAlt updates only the alt column of that asset, and rejects over-long text before any request", async () => {
    const { adapter, calls } = fakeClient({ "from:assets": {} });
    await adapter.updateAssetAlt("asset_x", "A photo");
    const ops = calls.find((c) => c.target === "from:assets")!.ops;
    expect(ops.find(([o]) => o === "update")![1][0]).toEqual({ alt: "A photo" });
    expect(ops.find(([o]) => o === "eq")![1]).toEqual(["id", "asset_x"]);
    const none = fakeClient({});
    await expect(none.adapter.updateAssetAlt("asset_x", "x".repeat(301))).rejects.toThrow(/too long/);
    expect(none.calls).toHaveLength(0);
  });
  it("listAssets maps derived columns, and tolerates rows without them", async () => {
    const base = { id: "asset_a", name: "a", kind: "webp", mime: "image/webp", bytes: 9, width: 2, height: 3, hash: "h", alt: null, created_at: "2025-01-01T00:00:00Z" };
    const rows = [{ ...base, derived_from_asset: "asset_o", derived_op: "rotate" }, { ...base, id: "asset_b" }, { ...base, id: "asset_c", derived_from_asset: "asset_o", derived_op: "weird" }];
    const out = await fakeClient({ "from:assets": { data: rows } }).adapter.listAssets();
    expect(out[0]!.derivedFrom).toEqual({ assetId: "asset_o", op: "rotate" });
    expect(out[1]!.derivedFrom).toBeUndefined();
    expect(out[2]!.derivedFrom).toBeUndefined(); // an unknown operation is ignored, not trusted
  });
  it("against a database without migration 2, listing and uploading still work (falls back once, then remembers)", async () => {
    const missing = { error: { code: "42703", message: 'column "derived_from_asset" does not exist' } };
    const base = { id: "asset_a", name: "a", kind: "webp", mime: "image/webp", bytes: 9, width: 2, height: 3, hash: "h", alt: null, created_at: "2025-01-01T00:00:00Z" };
    const { adapter, calls } = fakeClient({ "from:assets": [missing, { data: [base] }, {}] }); // list (old schema), list retry, then one clean upsert
    expect(await adapter.listAssets()).toHaveLength(1);
    await adapter.uploadAsset(asset("asset_x"), blob());
    const selects = calls.filter((c) => c.target === "from:assets").map((c) => c.ops.find(([o]) => o === "select")?.[1][0]);
    expect(String(selects[0])).toContain("derived_op");
    expect(String(selects[1])).not.toContain("derived_op"); // retried without the new columns
    const upserts = calls.filter((c) => c.target === "from:assets").flatMap((c) => c.ops.filter(([o]) => o === "upsert"));
    expect(upserts.length).toBeGreaterThan(0);
    expect(upserts).toHaveLength(1); // remembered from the listing: sent once, without the derived columns
    expect(Object.keys(upserts[0]![1][0] as object)).not.toContain("derived_op");
  });
  it("an upload can be the first to discover the old schema: it retries once without the new columns and succeeds", async () => {
    const missing = { error: { code: "PGRST204", message: "Could not find the 'derived_op' column of 'assets' in the schema cache" } };
    const { adapter, calls } = fakeClient({ "from:assets": [missing, {}] });
    await expect(adapter.uploadAsset({ ...asset("asset_x"), derivedFrom: { assetId: "asset_o", op: "crop" } }, blob())).resolves.toBeUndefined();
    const upserts = calls.filter((c) => c.target === "from:assets").flatMap((c) => c.ops.filter(([o]) => o === "upsert"));
    expect(upserts).toHaveLength(2);
    expect(Object.keys(upserts[0]![1][0] as object)).toContain("derived_op");
    expect(Object.keys(upserts[1]![1][0] as object)).not.toContain("derived_op");
  });
  it("other database errors are not mistaken for a missing column", async () => {
    const { adapter } = fakeClient({ "from:assets": { error: { code: "42501", message: "permission denied" } } });
    await expect(adapter.listAssets()).rejects.toThrow(CloudError);
  });
});

describe("supabase adapter: error mapping", () => {
  it("maps database codes to typed errors with safe messages", () => {
    expect(mapError({ code: "40001", message: "version_conflict" })).toBeInstanceOf(ConflictError);
    expect(mapError({ code: "P0002", message: "not_found" })).toBeInstanceOf(NotFoundError);
    expect(mapError({ code: "PGRST116", message: "0 rows" })).toBeInstanceOf(NotFoundError);
    expect(mapError({ code: "42501", message: 'new row violates row-level security policy for table "projects"' }).message).toBe("You don't have permission to do that.");
    expect(mapError({ code: "23514", message: 'violates check constraint "projects_json_shape"' }).message).not.toMatch(/constraint|projects_json/);
    expect(mapError({ code: "XX000", message: 'relation "secret_table" does not exist' }).message).not.toMatch(/secret_table/);
  });
});

describe("supabase adapter: behaviour", () => {
  it("saveProject calls the RPC with the base version, returns the new version", async () => {
    const { adapter, calls } = fakeClient({ "rpc:save_project": { data: [{ version: 5, updated_at: "x" }] } });
    expect(await adapter.saveProject("p1", 4, proj("N"))).toEqual({ version: 5 });
    const args = (calls.find((c) => c.target === "rpc:save_project")!.ops[0]![1] as any[])[0];
    expect(args).toMatchObject({ p_id: "p1", p_base_version: 4, p_name: "N" });
  });
  it("saveProject maps a stale version to ConflictError and a foreign project to NotFoundError", async () => {
    await expect(fakeClient({ "rpc:save_project": { error: { code: "40001", message: "version_conflict" } } }).adapter.saveProject("p", 1, proj())).rejects.toThrow(ConflictError);
    await expect(fakeClient({ "rpc:save_project": { error: { code: "P0002", message: "not_found" } } }).adapter.saveProject("p", 1, proj())).rejects.toThrow(NotFoundError);
  });
  it("saveProject rejects a malformed server reply instead of trusting it", async () => {
    await expect(fakeClient({ "rpc:save_project": { data: [] } }).adapter.saveProject("p", 1, proj())).rejects.toThrow(CloudError);
    await expect(fakeClient({ "rpc:save_project": { data: [{ version: "7" }] } }).adapter.saveProject("p", 1, proj())).rejects.toThrow(CloudError);
  });
  it("loadProject validates what the database returns", async () => {
    const good = fakeClient({ "from:projects": { data: { id: "p", name: "N", version: 2, json: proj("N") } } });
    expect((await good.adapter.loadProject("p")).version).toBe(2);
    const bad = fakeClient({ "from:projects": { data: { id: "p", name: "N", version: 2, json: { schemaVersion: 2, pages: [{ nonsense: true }] } } } });
    await expect(bad.adapter.loadProject("p")).rejects.toThrow(/invalid/);
    const xss = proj();
    xss.pages[0]!.nodes[1]!.children![0]!.props.ctaHref = "javascript:alert(1)";
    await expect(fakeClient({ "from:projects": { data: { id: "p", name: "N", version: 1, json: xss } } }).adapter.loadProject("p")).rejects.toThrow(/invalid/);
  });
  it("createProject sets the owner from the session", async () => {
    const { adapter, calls } = fakeClient({ "from:projects": { data: { id: "new", version: 1 } } });
    expect(await adapter.createProject(proj("Hello"))).toEqual({ id: "new", version: 1 });
    const insert = calls.find((c) => c.target === "from:projects")!.ops.find(([op]) => op === "insert")!;
    expect((insert[1][0] as any).owner_id).toBe("u1");
  });
  it("write calls require a session", async () => {
    const { adapter } = fakeClient({}, null);
    await expect(adapter.createProject(proj())).rejects.toThrow(/not signed in/);
    await expect(adapter.uploadAsset(asset("asset_x"), blob())).rejects.toThrow(/not signed in/);
  });
  it("uploadAsset: an existing file (409) is success; a real failure is not", async () => {
    const dup = fakeClient({ "storage:upload": { error: { message: "The resource already exists", statusCode: "409" } }, "from:assets": {} });
    await expect(dup.adapter.uploadAsset(asset("asset_x"), blob())).resolves.toBeUndefined();
    const dupRow = fakeClient({ "from:assets": { error: { code: "23505", message: "duplicate key" } } });
    await expect(dupRow.adapter.uploadAsset(asset("asset_x"), blob())).resolves.toBeUndefined();
    const fail = fakeClient({ "storage:upload": { error: { message: "boom", statusCode: "500" } } });
    await expect(fail.adapter.uploadAsset(asset("asset_x"), blob())).rejects.toThrow(CloudError);
  });
  it("uploadAsset stores under <owner>/<id>", async () => {
    const { adapter, calls } = fakeClient({ "from:assets": {} });
    await adapter.uploadAsset(asset("asset_x"), blob());
    const upsert = calls.find((c) => c.target === "from:assets")!.ops.find(([op]) => op === "upsert")!;
    expect((upsert[1][0] as any).storage_key).toBe("u1/asset_x");
  });
  it("listAssets converts rows to Asset objects", async () => {
    const row = { id: "asset_a", name: "a", kind: "webp", mime: "image/webp", bytes: 9, width: 2, height: 3, hash: "h", alt: null, created_at: "2025-01-01T00:00:00Z" };
    const [a] = await fakeClient({ "from:assets": { data: [row] } }).adapter.listAssets();
    expect(a).toMatchObject({ id: "asset_a", width: 2, height: 3, alt: undefined, createdAt: Date.parse("2025-01-01T00:00:00Z") });
  });
  it("signInWithEmail surfaces a friendly message, not the provider's raw error", async () => {
    const { adapter } = fakeClient({ otp: { error: { message: "email rate limit exceeded" } } });
    await expect(adapter.signInWithEmail("a@b.co")).rejects.toThrow(/Too many attempts/);
    const { adapter: a2 } = fakeClient({ otp: { error: { message: "SMTP host smtp.internal:25 refused" } } });
    const err = await a2.signInWithEmail("a@b.co").then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(CloudError);
    expect(err!.message).not.toMatch(/smtp|internal|25/);
  });
});

describe("memory adapter: site name and contact-form inbox", () => {
  const withSub = (kv: KV, row: Record<string, unknown>) => {
    const db = JSON.parse(kv.getItem("avc:mockcloud:v1")!);
    (db.submissions ??= []).push(row);
    kv.setItem("avc:mockcloud:v1", JSON.stringify(db));
  };
  it("no site until one is saved; a site can be created and renamed", async () => {
    const { A } = await pair();
    const { id } = await A.createProject(proj());
    expect(await A.getSite(id)).toBeNull();
    expect(await A.saveSite(id, "my-school")).toEqual({ slug: "my-school", formsEnabled: true });
    expect((await A.getSite(id))?.slug).toBe("my-school");
    await A.saveSite(id, "new-name");
    expect((await A.getSite(id))?.slug).toBe("new-name");
  });
  it("refuses invalid names and names someone else has", async () => {
    const { A, B } = await pair("a@x.co", "b@x.co");
    const { id: idB } = await B.createProject(proj());
    for (const bad of ["", "ab", "-abc", "abc-", "ABC", "has space", "a".repeat(41), "x_y_z"]) await expect(B.saveSite(idB, bad)).rejects.toThrow(CloudError);
    await B.saveSite(idB, "taken-name");
    // alice signs in on the same server and tries the same name for her own project
    await A.signInWithEmail("a@x.co");
    const { id: idA } = await A.createProject(proj());
    await expect(A.saveSite(idA, "taken-name")).rejects.toThrow(/already taken/);
  });
  it("cannot make a site for a project that isn't yours", async () => {
    const { A, B } = await pair("a@x.co", "b@x.co");
    const { id } = await B.createProject(proj());
    await A.signInWithEmail("a@x.co");
    await expect(A.saveSite(id, "steal-it")).rejects.toThrow(NotFoundError);
  });
  it("the owner sees their submissions newest first; others see none and cannot delete them", async () => {
    const { A, B, kv } = await pair("a@x.co", "b@x.co");
    const { id } = await B.createProject(proj());
    await B.saveSite(id, "my-school");
    withSub(kv, { id: "s1", slug: "my-school", formId: "contact1", fields: { email: "old@x.co" }, createdAt: "2025-01-01T00:00:00Z" });
    withSub(kv, { id: "s2", slug: "my-school", formId: "contact1", fields: { email: "new@x.co" }, createdAt: "2025-02-01T00:00:00Z" });
    withSub(kv, { id: "s3", slug: "someone-else", formId: "c", fields: { email: "z@x.co" }, createdAt: "2025-03-01T00:00:00Z" });
    expect((await B.listSubmissions(id)).map((s) => s.id)).toEqual(["s2", "s1"]);
    await A.signInWithEmail("a@x.co");
    expect(await A.listSubmissions(id)).toEqual([]);
    await A.deleteSubmission("s1"); // not hers: nothing happens
    await B.signInWithEmail("b@x.co");
    expect(await B.listSubmissions(id)).toHaveLength(2);
    await B.deleteSubmission("s1");
    expect((await B.listSubmissions(id)).map((s) => s.id)).toEqual(["s2"]);
  });
});

describe("supabase adapter: site name and inbox", () => {
  it("getSite maps the row, or null when there is none", async () => {
    expect(await fakeClient({ "from:sites": { data: { slug: "my-school", forms_enabled: true } } }).adapter.getSite("p1")).toEqual({ slug: "my-school", formsEnabled: true });
    expect(await fakeClient({ "from:sites": { data: null } }).adapter.getSite("p1")).toBeNull();
  });
  it("saveSite upserts on project_id with the signed-in user as owner, and validates before any request", async () => {
    const { adapter, calls } = fakeClient({ "from:sites": { data: { slug: "my-school", forms_enabled: true } } });
    await adapter.saveSite("p1", "my-school");
    const up = calls.find((c) => c.target === "from:sites")!.ops.find(([o]) => o === "upsert")!;
    expect(up[1][0]).toEqual({ owner_id: "u1", project_id: "p1", slug: "my-school" });
    expect(up[1][1]).toEqual({ onConflict: "project_id" });
    const none = fakeClient({});
    await expect(none.adapter.saveSite("p1", "Bad Name")).rejects.toThrow(/lowercase/);
    expect(none.calls).toHaveLength(0);
  });
  it("a taken name is reported plainly, other failures with safe text", async () => {
    await expect(fakeClient({ "from:sites": { error: { code: "23505", message: 'duplicate key value violates unique constraint "sites_slug_key"' } } }).adapter.saveSite("p1", "taken-name")).rejects.toThrow(/already taken/);
    const e = await fakeClient({ "from:sites": { error: { code: "XX000", message: "internal: secret detail" } } }).adapter.saveSite("p1", "fine-name").catch((x) => x);
    expect(e).toBeInstanceOf(CloudError);
    expect(e.message).not.toContain("secret");
  });
  it("listSubmissions filters by the project's site, newest first, and keeps only string fields", async () => {
    const rows = [{ id: "s1", form_id: "c1", created_at: "2025-01-01T00:00:00Z", payload: { email: "a@b.co", evil: { x: 1 }, n: 5 } }];
    const { adapter, calls } = fakeClient({ "from:form_submissions": { data: rows } });
    const out = await adapter.listSubmissions("p1");
    expect(out).toEqual([{ id: "s1", formId: "c1", createdAt: "2025-01-01T00:00:00Z", fields: { email: "a@b.co" } }]);
    const ops = calls[0]!.ops;
    expect(ops.find(([o]) => o === "eq")![1]).toEqual(["sites.project_id", "p1"]);
    expect(ops.find(([o]) => o === "order")![1]).toEqual(["created_at", { ascending: false }]);
    expect(ops.find(([o]) => o === "limit")![1]).toEqual([200]);
  });
  it("deleteSubmission deletes by id", async () => {
    const { adapter, calls } = fakeClient({ "from:form_submissions": {} });
    await adapter.deleteSubmission("s1");
    expect(calls[0]!.ops.find(([o]) => o === "eq")![1]).toEqual(["id", "s1"]);
  });
});

describe("quotas, usage and account deletion", () => {
  it("memory adapter: 25 projects, then a friendly refusal; deleting one makes room", async () => {
    const { A } = await pair();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await A.createProject(proj(`P${i}`))).id);
    await expect(A.createProject(proj("one too many"))).rejects.toThrow(/limit of 25 projects/);
    await A.deleteProject(ids[0]!);
    await A.createProject(proj("fits now"));
    expect((await A.getUsage())).toMatchObject({ projects: 25, projectsLimit: 25 });
  });
  it("memory adapter: storage limit of 200 MB, counting what is stored; repeats are free", async () => {
    const { A } = await pair();
    const big = (id: string, bytes: number, hash: string): Asset => ({ ...asset(id, hash), bytes });
    for (let i = 0; i < 10; i++) await A.uploadAsset(big(`asset_f${i}`, 20 * 1024 * 1024, String(i).padEnd(64, "a")), blob());
    await A.uploadAsset(big("asset_f0", 20 * 1024 * 1024, "0".padEnd(64, "a")), blob()); // same file again: not counted twice
    await expect(A.uploadAsset(big("asset_over", 1024, "b".padEnd(64, "b")), blob())).rejects.toThrow(/storage is full/);
    expect((await A.getUsage())!.storageBytes).toBe(200 * 1024 * 1024);
  });
  it("memory adapter: deleting the account removes everything of theirs, only theirs", async () => {
    const { A, B } = await pair("a@x.co", "b@x.co");
    const { id } = await B.createProject(proj("Bobs"));
    await B.uploadAsset(asset("asset_bob"), blob());
    await B.saveSite(id, "bobs-site");
    await B.deleteAccount();
    expect(await B.user()).toBeNull();
    await A.signInWithEmail("a@x.co");
    const { id: aid } = await A.createProject(proj("Alices"));
    await B.signInWithEmail("b@x.co"); // signing in again gives an empty account
    expect(await B.listProjects()).toEqual([]);
    expect(await B.listAssets()).toEqual([]);
    expect(await B.getSite(id)).toBeNull();
    await A.signInWithEmail("a@x.co");
    expect((await A.listProjects()).map((p) => p.id)).toEqual([aid]);
  });
  it("supabase adapter: quota errors become friendly messages, usage is read and validated", async () => {
    for (const [msg, re] of [["quota_projects", /limit of 25 projects/], ["quota_storage", /storage is full/], ["quota_submissions", /inbox is full/]] as const) {
      expect(mapError({ code: "R0413", message: msg })).toMatchObject({ message: expect.stringMatching(re) });
    }
    const ok = await fakeClient({ "rpc:my_usage": { data: { projects: 3, projectsLimit: 25, storageBytes: 100, storageLimit: 200 } } }).adapter.getUsage();
    expect(ok).toEqual({ projects: 3, projectsLimit: 25, storageBytes: 100, storageLimit: 200 });
    expect(await fakeClient({ "rpc:my_usage": { error: { code: "PGRST202", message: "function not found" } } }).adapter.getUsage()).toBeNull(); // migration 4 not applied
    expect(await fakeClient({ "rpc:my_usage": { data: { projects: "x" } } }).adapter.getUsage()).toBeNull(); // garbage is not trusted
  });
});
