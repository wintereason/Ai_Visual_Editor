import { describe, expect, it } from "vitest";
import { exampleProject, type Asset, type Project } from "@avc/schema";
import { CloudError, ConflictError, NotFoundError, ReadOnlyError, createMemoryAdapter, mapError, type CloudAdapter, type KV } from "../src";

const memKv = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const proj = (name = "Site"): Project => ({ ...structuredClone(exampleProject), name });
const asset = (id: string, hash = id.padEnd(64, "0")): Asset => ({ id, name: id, kind: "webp", mime: "image/webp", bytes: 3, width: 1, height: 1, hash, createdAt: 1 });
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
const withAsset = (p: Project, id: string): Project => {
  const q = structuredClone(p);
  q.pages[0]!.nodes[1]!.children!.push({ id: `img_${id}`, kind: "element", type: "image", props: { assetId: id, alt: "x", fit: "cover" } });
  return q;
};

/** One server, several people: `as()` signs the single adapter in as someone else (the memory server keeps one session). */
function world() {
  const a: CloudAdapter = createMemoryAdapter(memKv());
  const as = async (email: string) => { await a.signInWithEmail(email); return a; };
  return { a, as };
}
const ALICE = "alice@example.com", BOB = "bob@example.com", CAROL = "carol@example.com";

async function shared(role: "editor" | "viewer" = "editor") {
  const w = world();
  await w.as(ALICE);
  const { id } = await w.a.createProject(proj("Shared site"));
  await w.a.shareProject(id, BOB, role);
  await w.as(BOB);
  await w.a.claimInvites();
  return { ...w, id };
}

describe("sharing is an invitation until the invitee signs in", () => {
  it("gives no access before it is claimed, and the owner sees it as invited", async () => {
    const w = world();
    await w.as(ALICE);
    const { id } = await w.a.createProject(proj());
    await w.a.shareProject(id, "  Bob@Example.com ", "editor");
    expect((await w.a.listPeople(id)).map((p) => [p.kind, p.email, p.role])).toEqual([["invited", "bob@example.com", "editor"]]);
    await w.as(BOB);
    await expect(w.a.loadProject(id)).rejects.toThrow(NotFoundError);
    expect(await w.a.listShared()).toEqual([]);
    expect(await w.a.projectVersion(id)).toBeNull();
  });

  it("claiming gives the right role, once, and shows the project in the invitee's shared list", async () => {
    const w = world();
    await w.as(ALICE);
    const { id } = await w.a.createProject(proj("Shared site"));
    await w.a.shareProject(id, BOB, "viewer");
    await w.as(BOB);
    expect(await w.a.claimInvites()).toBe(1);
    expect(await w.a.claimInvites()).toBe(0);
    const loaded = await w.a.loadProject(id);
    expect(loaded.role).toBe("viewer");
    expect(loaded.name).toBe("Shared site");
    expect((await w.a.listShared()).map((s) => [s.id, s.role, s.ownerEmail])).toEqual([[id, "viewer", ALICE]]);
    expect(await w.a.listProjects()).toEqual([]); // "my projects" stays only what I own
    await w.as(ALICE);
    expect((await w.a.listPeople(id)).map((p) => [p.kind, p.email, p.role])).toEqual([["member", BOB, "viewer"]]);
    expect((await w.a.loadProject(id)).role).toBe("owner");
  });

  it("someone else can't claim it, and invitations expire after 30 days", async () => {
    const w = world();
    await w.as(ALICE);
    const { id } = await w.a.createProject(proj());
    await w.a.shareProject(id, BOB, "editor");
    await w.as(CAROL);
    expect(await w.a.claimInvites()).toBe(0);
    await expect(w.a.loadProject(id)).rejects.toThrow(NotFoundError);
    const kv = memKv();
    const a2 = createMemoryAdapter(kv);
    await a2.signInWithEmail(ALICE);
    const p2 = await a2.createProject(proj());
    await a2.shareProject(p2.id, BOB, "editor");
    const db = JSON.parse(kv.getItem("avc:mockcloud:v1")!);
    db.invites[0].createdAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
    kv.setItem("avc:mockcloud:v1", JSON.stringify(db));
    await a2.signInWithEmail(BOB);
    expect(await a2.claimInvites()).toBe(0);
  });

  it("sharing with an email that has an account and one that doesn't behaves identically (no probing)", async () => {
    const w = world();
    await w.as(CAROL); // carol now "has an account"
    await w.as(ALICE);
    const { id } = await w.a.createProject(proj());
    await w.a.shareProject(id, CAROL, "viewer");
    await w.a.shareProject(id, "stranger@nowhere.example", "viewer");
    const people = await w.a.listPeople(id);
    expect(people.map((p) => p.kind)).toEqual(["invited", "invited"]);
    expect(people.every((p) => p.userId === undefined)).toBe(true);
  });
});

describe("only the owner manages access", () => {
  it("a member or stranger can't share, list people, or unshare; the owner can't share with themself or with junk", async () => {
    const { a, as, id } = await shared("editor");
    await expect(a.shareProject(id, CAROL, "editor")).rejects.toThrow(/Only the project's owner/);
    await expect(a.listPeople(id)).rejects.toThrow(/Only the project's owner/);
    await expect(a.unshare(id, { email: CAROL })).rejects.toThrow(/Only the project's owner/);
    await as(CAROL);
    await expect(a.shareProject(id, BOB, "editor")).rejects.toThrow(/Only the project's owner/);
    await as(ALICE);
    await expect(a.shareProject(id, ALICE, "editor")).rejects.toThrow(/your own email/);
    for (const bad of ["", "nope", "a@b"]) await expect(a.shareProject(id, bad, "editor")).rejects.toThrow(/valid email/);
    await expect(a.shareProject(id, CAROL, "owner" as never)).rejects.toThrow(/editor or viewer/);
  });

  it("at most 10 people, and changing someone's role doesn't count as a new person", async () => {
    const w = world();
    await w.as(ALICE);
    const { id } = await w.a.createProject(proj());
    for (let i = 0; i < 10; i++) await w.a.shareProject(id, `p${i}@example.com`, "viewer");
    await expect(w.a.shareProject(id, "extra@example.com", "viewer")).rejects.toThrow(/up to 10/);
    await w.a.shareProject(id, "p2@example.com", "editor");
    expect(await w.a.listPeople(id)).toHaveLength(10);
  });

  it("changing a role takes effect when they next claim; removing a member ends access at once; a withdrawn invite can't be claimed", async () => {
    const { a, as, id } = await shared("editor");
    await as(ALICE);
    await a.shareProject(id, BOB, "viewer");
    await as(BOB);
    expect((await a.loadProject(id)).role).toBe("editor");
    await a.claimInvites();
    expect((await a.loadProject(id)).role).toBe("viewer");
    await as(ALICE);
    const bob = (await a.listPeople(id)).find((p) => p.email === BOB)!;
    await a.unshare(id, { userId: bob.userId });
    await as(BOB);
    await expect(a.loadProject(id)).rejects.toThrow(NotFoundError);
    await as(ALICE);
    await a.shareProject(id, CAROL, "editor");
    await a.unshare(id, { email: "CAROL@example.com" });
    await as(CAROL);
    expect(await a.claimInvites()).toBe(0);
  });

  it("a member can leave", async () => {
    const { a, id } = await shared("viewer");
    await a.leaveProject(id);
    await expect(a.loadProject(id)).rejects.toThrow(NotFoundError);
  });
});

describe("what members can do", () => {
  it("a viewer can read but every write is refused, clearly, and nothing changes", async () => {
    const { a, as, id } = await shared("viewer");
    const loaded = await a.loadProject(id);
    await expect(a.saveProject(id, loaded.version, proj("Hacked"))).rejects.toThrow(ReadOnlyError);
    await expect(a.snapshot(id, "x")).rejects.toThrow(ReadOnlyError);
    await a.deleteProject(id); // silently nothing, like the database
    await as(ALICE);
    const mine = await a.loadProject(id);
    expect(mine.name).toBe("Shared site");
    expect(mine.version).toBe(1);
  });

  it("an editor saves, and the optimistic-concurrency rule still stops one person overwriting another", async () => {
    const { a, as, id } = await shared("editor");
    const bob = await a.loadProject(id);
    expect((await a.saveProject(id, bob.version, proj("Bob's edit"))).version).toBe(2);
    await as(ALICE);
    await expect(a.saveProject(id, 1, proj("Alice, stale"))).rejects.toThrow(ConflictError);
    expect((await a.loadProject(id)).name).toBe("Bob's edit");
    expect((await a.saveProject(id, 2, proj("Alice's edit"))).version).toBe(3);
    await as(BOB);
    expect(await a.projectVersion(id)).toBe(3); // how Bob finds out Alice saved
  });

  it("an editor can't delete the project; history is shared and stays the owner's", async () => {
    const { a, as, id } = await shared("editor");
    await a.snapshot(id, "bob checkpoint");
    await a.deleteProject(id);
    expect((await a.listVersions(id)).map((v) => v.reason)).toEqual(["bob checkpoint"]);
    await as(ALICE);
    expect((await a.loadProject(id)).name).toBe("Shared site");
    expect((await a.listVersions(id)).map((v) => v.reason)).toEqual(["bob checkpoint"]);
    await a.deleteProject(id);
    await as(BOB);
    await expect(a.loadProject(id)).rejects.toThrow(NotFoundError);
  });

  it("publishing and the form inbox stay with the owner", async () => {
    const { a, id } = await shared("editor");
    await expect(a.saveSite(id, "my-site")).rejects.toThrow(NotFoundError);
    expect(await a.getSite(id)).toBeNull();
    expect(await a.listSubmissions(id)).toEqual([]);
  });
});

describe("pictures follow the project", () => {
  it("a member sees and can download the pictures the project uses, and only those", async () => {
    const w = world();
    await w.as(ALICE);
    await w.a.uploadAsset(asset("asset_used"), blob());
    await w.a.uploadAsset(asset("asset_other", "b".repeat(64)), blob());
    const { id } = await w.a.createProject(withAsset(proj(), "asset_used"));
    await w.a.shareProject(id, BOB, "viewer");
    await w.as(BOB);
    await w.a.claimInvites();
    expect((await w.a.listAssets()).map((x) => x.id)).toEqual(["asset_used"]);
    await expect(w.a.downloadAsset(asset("asset_used"))).resolves.toBeInstanceOf(Blob);
    await expect(w.a.downloadAsset(asset("asset_other"))).rejects.toThrow(NotFoundError);
    await w.as(CAROL);
    expect(await w.a.listAssets()).toEqual([]);
  });

  it("a collaborator's upload reaches the owner once the project uses it, and re-uploading a picture someone already holds is fine", async () => {
    const { a, as, id } = await shared("editor");
    await a.uploadAsset(asset("asset_bobs", "c".repeat(64)), blob());
    const loaded = await a.loadProject(id);
    await a.saveProject(id, loaded.version, withAsset(loaded.project, "asset_bobs"));
    await as(ALICE);
    expect((await a.listAssets()).map((x) => x.id)).toContain("asset_bobs");
    await a.uploadAsset(asset("asset_bobs", "c".repeat(64)), blob()); // alice picks the same file: succeeds, nothing duplicated
    await as(BOB);
    expect((await a.listAssets()).filter((x) => x.id === "asset_bobs")).toHaveLength(1);
  });

  it("naming someone else's picture inside your own project grants nothing", async () => {
    const w = world();
    await w.as(ALICE);
    await w.a.uploadAsset(asset("asset_private"), blob());
    await w.as(BOB);
    await w.a.createProject(withAsset(proj(), "asset_private"));
    expect(await w.a.listAssets()).toEqual([]);
    await expect(w.a.downloadAsset(asset("asset_private"))).rejects.toThrow(NotFoundError);
  });
});

describe("cleanup", () => {
  it("deleting an account removes its sharing records both ways", async () => {
    const { a, as, id } = await shared("editor");
    await as(ALICE);
    await a.shareProject(id, CAROL, "viewer");
    await a.deleteAccount();
    await as(BOB);
    await expect(a.loadProject(id)).rejects.toThrow(NotFoundError);
    expect(await a.listShared()).toEqual([]);
    await as(CAROL);
    expect(await a.claimInvites()).toBe(0);
  });
});

describe("database errors from sharing are mapped to plain messages", () => {
  const e = (msg: string, code?: string) => mapError({ message: msg, code } as never);
  it("maps each to a safe message or a typed error", () => {
    expect(e("read_only", "42501")).toBeInstanceOf(ReadOnlyError);
    expect(e("too_many_people", "54000").message).toMatch(/up to 10/);
    expect(e("cannot_share_with_self", "22023").message).toMatch(/your own/);
    expect(e("bad_email", "22023").message).toMatch(/valid email/);
    expect(e("not_owner", "42501").message).toMatch(/owner/);
    expect(e("not_owner", "42501")).toBeInstanceOf(CloudError);
    expect(e("some raw SQL: select * from secrets").message).not.toMatch(/select|secrets/i);
  });
});
