import { describe, expect, it } from "vitest";
import type { Asset } from "@avc/schema";
import { CloudError, NotFoundError, createMemoryAdapter, createSupabaseAdapter, type KV } from "../src";

// Regression tests for the asset-id collision: an asset's id comes from the file's content, so two accounts that upload the
// same picture share an id. Each account must keep its own copy, and neither must disturb the other.

const memKv = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const HASH = "a".repeat(64);
const ID = `asset_${HASH.slice(0, 24)}`;
const pic = (id = ID, hash = HASH): Asset => ({ id, name: "photo.png", kind: "png", mime: "image/png", bytes: 3, width: 1, height: 1, hash, createdAt: 1 });
const blob = (n = 1) => new Blob([new Uint8Array([n, n, n])], { type: "image/png" });
const bytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

describe("two accounts, the same picture (memory adapter, which mirrors the database rules)", () => {
  function world() {
    const a = createMemoryAdapter(memKv());
    return { a, as: async (email: string) => { await a.signInWithEmail(email); return a; } };
  }

  it("both accounts can upload identical files, and each lists and downloads exactly its own copy", async () => {
    const { a, as } = world();
    await as("alice@example.com"); await a.uploadAsset(pic(), blob(1));
    await as("bob@example.com"); await a.uploadAsset(pic(), blob(1)); // used to be refused: the id already existed
    expect((await a.listAssets()).map((x) => x.id)).toEqual([ID]);
    expect(await bytes(await a.downloadAsset(pic()))).toEqual([1, 1, 1]);
    await as("alice@example.com");
    expect((await a.listAssets()).map((x) => x.id)).toEqual([ID]);
  });

  it("accounts don't share a fate: when one deletes its copy, the other still has the picture", async () => {
    const { a, as } = world();
    await as("alice@example.com"); await a.uploadAsset(pic(), blob(1));
    await as("bob@example.com"); await a.uploadAsset(pic(), blob(1));
    await as("alice@example.com"); await a.deleteAsset(ID);
    expect(await a.listAssets()).toEqual([]);
    await expect(a.downloadAsset(pic())).rejects.toThrow(NotFoundError);
    await as("bob@example.com");
    expect(await bytes(await a.downloadAsset(pic()))).toEqual([1, 1, 1]);
    expect((await a.listAssets()).map((x) => x.id)).toEqual([ID]);
  });

  it("one account can't read, change or delete another's copy", async () => {
    const { a, as } = world();
    await as("alice@example.com"); await a.uploadAsset(pic(), blob(1));
    await as("carol@example.com");
    expect(await a.listAssets()).toEqual([]);
    await expect(a.downloadAsset(pic())).rejects.toThrow(NotFoundError);
    await a.deleteAsset(ID); await a.updateAssetAlt(ID, "x").catch(() => {});
    await as("alice@example.com");
    expect((await a.listAssets()).map((x) => x.id)).toEqual([ID]);
    expect((await a.listAssets())[0]!.alt).toBeUndefined();
  });

  it("repeated uploads by the same account are idempotent, and the same bytes under another id are not stored twice", async () => {
    const { a, as } = world();
    await as("alice@example.com");
    await a.uploadAsset(pic(), blob(1));
    await a.uploadAsset(pic(), blob(1));
    await a.uploadAsset(pic("asset_otherid", HASH), blob(1));
    expect((await a.listAssets()).map((x) => x.id)).toEqual([ID]);
    expect((await a.getUsage())!.storageBytes).toBe(3);
  });

  it("storage usage is per account", async () => {
    const { a, as } = world();
    await as("alice@example.com"); await a.uploadAsset(pic(), blob(1));
    await as("bob@example.com"); await a.uploadAsset(pic(), blob(1));
    expect((await a.getUsage())!.storageBytes).toBe(3);
    await as("alice@example.com");
    expect((await a.getUsage())!.storageBytes).toBe(3);
  });
});

// ---- the Supabase adapter, against a scripted client ----
type Reply = { data?: unknown; error?: { code?: string; message?: string } | null };
function client(script: Record<string, Reply[] | Reply>, userId = "u1") {
  const calls: { target: string; ops: [string, unknown[]][] }[] = [];
  const next = (key: string): Reply => { const s = script[key]; const r = Array.isArray(s) ? s.shift() : s; return { data: null, error: null, ...(r ?? {}) }; };
  const chain = (key: string) => {
    const rec = { target: key, ops: [] as [string, unknown[]][] };
    calls.push(rec);
    const p: any = new Proxy(() => {}, { get(_t, prop: string) { if (prop === "then") return (res: (v: Reply) => void) => res(next(key)); return (...args: unknown[]) => (rec.ops.push([prop, args]), p); } });
    return p;
  };
  const c: any = {
    auth: { getSession: async () => ({ data: { session: { user: { id: userId, email: "a@b.co" } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: (t: string) => chain(`from:${t}`),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ upload: async () => next("storage:upload"), download: async (key: string) => (calls.push({ target: "download", ops: [["key", [key]]] }), next("storage:download")), remove: async () => next("storage:remove") }) },
  };
  return { adapter: createSupabaseAdapter(c), calls };
}
const upserts = (calls: ReturnType<typeof client>["calls"]) => calls.filter((c) => c.target === "from:assets").flatMap((c) => c.ops.filter(([o]) => o === "upsert").map(([, a]) => ({ row: a[0] as Record<string, unknown>, opts: a[1] as { onConflict: string } })));

describe("supabase adapter: pictures keyed by owner + id", () => {
  it("uploads with the per-owner key (owner_id, id)", async () => {
    const { adapter, calls } = client({});
    await adapter.uploadAsset(pic(), blob());
    expect(upserts(calls).map((u) => u.opts.onConflict)).toEqual(["owner_id,id"]);
    expect(upserts(calls)[0]!.row).toMatchObject({ id: ID, owner_id: "u1", storage_key: `u1/${ID}` });
  });

  it("a database that hasn't had migration 7 (no matching unique key) is retried once with the old key, and remembered", async () => {
    const noKey = { error: { code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" } };
    const { adapter, calls } = client({ "from:assets": [noKey, {}, {}] });
    await expect(adapter.uploadAsset(pic(), blob())).resolves.toBeUndefined();
    await expect(adapter.uploadAsset(pic("asset_second", "b".repeat(64)), blob())).resolves.toBeUndefined();
    expect(upserts(calls).map((u) => u.opts.onConflict)).toEqual(["owner_id,id", "id", "id"]); // the second upload went straight to the old key
  });

  it("downloads my own copy when several accounts hold the picture", async () => {
    const rows = [{ storage_key: `other/${ID}`, owner_id: "other" }, { storage_key: `u1/${ID}`, owner_id: "u1" }];
    const { adapter, calls } = client({ "from:assets": { data: rows }, "storage:download": { data: blob() } });
    await adapter.downloadAsset(pic());
    expect(calls.find((c) => c.target === "download")!.ops[0]![1]).toEqual([`u1/${ID}`]);
  });

  it("downloads a copy someone else shared when I have none of my own", async () => {
    const { adapter, calls } = client({ "from:assets": { data: [{ storage_key: `other/${ID}`, owner_id: "other" }] }, "storage:download": { data: blob() } });
    await adapter.downloadAsset(pic());
    expect(calls.find((c) => c.target === "download")!.ops[0]![1]).toEqual([`other/${ID}`]);
  });

  it("the library shows each picture once, preferring my own copy", async () => {
    const mk = (owner: string, name: string) => ({ id: ID, owner_id: owner, name, kind: "png", mime: "image/png", bytes: 3, width: 1, height: 1, hash: HASH, alt: null, created_at: "2025-01-01T00:00:00Z" });
    const { adapter } = client({ "from:assets": { data: [mk("other", "theirs"), mk("u1", "mine"), mk("other", "theirs again")] } });
    const list = await adapter.listAssets();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("mine");
  });

  it("a real permission failure is still an error (it isn't mistaken for 'already stored')", async () => {
    const denied = { error: { code: "42501", message: "new row violates row-level security policy" } };
    const { adapter } = client({ "from:assets": [denied, { data: null }] }); // the follow-up "is it visible to me?" finds nothing
    await expect(adapter.uploadAsset(pic(), blob())).rejects.toThrow(CloudError);
  });
});
