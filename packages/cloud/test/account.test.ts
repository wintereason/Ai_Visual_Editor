import { describe, expect, it } from "vitest";
import { handleDeleteAccount, type AdminLike } from "../src/account";

function fake(files: Record<string, string[]> = { u1: ["asset_a", "asset_b"], u2: ["asset_z"] }, over: Partial<AdminLike> = {}) {
  const store = structuredClone(files);
  const deleted: string[] = [];
  const admin: AdminLike = {
    listFiles: async (p) => (store[p] ?? []).slice(0, 1000),
    removeFiles: async (paths) => { for (const x of paths) { const [u, f] = x.split("/"); store[u!] = (store[u!] ?? []).filter((n) => n !== f); } },
    deleteUser: async (id) => { deleted.push(id); },
    ...over,
  };
  return { store, deleted, admin };
}
const req = (body: unknown = { confirm: "DELETE" }, method = "DELETE") =>
  new Request("http://x/api/account", { method, headers: { "content-type": "application/json", authorization: "Bearer t" }, body: method === "DELETE" ? JSON.stringify(body) : undefined });
const auth = (id: string | null) => async () => id;
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });

describe("handleDeleteAccount", () => {
  it("removes the person's files and then the account, and nobody else's", async () => {
    const f = fake();
    const { status, body } = await read(await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: f.admin }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(f.store.u1).toEqual([]);
    expect(f.store.u2).toEqual(["asset_z"]);
    expect(f.deleted).toEqual(["u1"]);
  });
  it("handles more files than one listing returns", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `asset_${i}`);
    const f = fake({ u1: many });
    await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: f.admin });
    expect(f.store.u1).toEqual([]);
    expect(f.deleted).toEqual(["u1"]);
  });
  it("uses the VERIFIED id, whatever the request says, and ignores path tricks in file names", async () => {
    const f = fake();
    const seen: string[] = [];
    const admin = { ...f.admin, removeFiles: async (p: string[]) => { seen.push(...p); await f.admin.removeFiles(p); }, listFiles: async (p: string) => (p === "u1" ? ["../u2/asset_z", "asset_a"] : []) };
    await handleDeleteAccount(req({ confirm: "DELETE", userId: "u2" }), { authenticate: auth("u1"), admin });
    expect(seen.every((p) => p.startsWith("u1/"))).toBe(true);
    expect(f.store.u2).toEqual(["asset_z"]);
    expect(f.deleted).toEqual(["u1"]);
  });
  it("refuses without a valid sign-in, including when the authenticator throws; nothing is touched", async () => {
    for (const authenticate of [auth(null), async () => { throw new Error("boom"); }]) {
      const f = fake();
      const r = await read(await handleDeleteAccount(req(), { authenticate, admin: f.admin }));
      expect(r.status).toBe(401);
      expect(f.deleted).toEqual([]);
      expect(f.store.u1).toHaveLength(2);
    }
  });
  it("refuses unless the request carries the exact confirmation", async () => {
    for (const body of [{}, { confirm: "delete" }, { confirm: true }, null, "DELETE"]) {
      const f = fake();
      const r = await read(await handleDeleteAccount(req(body), { authenticate: auth("u1"), admin: f.admin }));
      expect(r.status).toBe(400);
      expect(f.deleted).toEqual([]);
    }
    const f = fake();
    const bad = new Request("http://x", { method: "DELETE", body: "not json", headers: { authorization: "Bearer t" } });
    expect((await handleDeleteAccount(bad, { authenticate: auth("u1"), admin: f.admin })).status).toBe(400);
  });
  it("only DELETE is accepted", async () => {
    const f = fake();
    for (const m of ["GET", "POST"]) expect((await handleDeleteAccount(req(undefined, m), { authenticate: auth("u1"), admin: f.admin })).status).toBe(405);
    expect(f.deleted).toEqual([]);
  });
  it("says so plainly when the server has no admin access", async () => {
    expect((await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: null })).status).toBe(503);
  });
  it("if removing files fails the account is NOT deleted, and no internals leak", async () => {
    const f = fake(undefined, { removeFiles: async () => { throw new Error("storage secret detail sk-ant-XYZ"); } });
    const r = await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: f.admin });
    const text = await r.text();
    expect(r.status).toBe(503);
    expect(f.deleted).toEqual([]);
    expect(text).not.toMatch(/secret|sk-ant|storage/i);
  });
  it("if deleting the user fails after the files went, a retry succeeds", async () => {
    let fail = true;
    const f = fake(undefined, { deleteUser: async () => { if (fail) { fail = false; throw new Error("db down"); } } });
    expect((await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: f.admin })).status).toBe(503);
    expect((await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: f.admin })).status).toBe(200);
  });
  it("logs events without ids or error text", async () => {
    const logs: unknown[] = [];
    const f = fake();
    await handleDeleteAccount(req(), { authenticate: auth("u1"), admin: f.admin, log: (e) => logs.push(e) });
    expect(logs).toEqual([{ event: "account_deleted" }]);
  });
});
