import { validateProject, type Asset, type Project } from "@avc/schema";
import {
  CloudError, ConflictError, NotFoundError, ReadOnlyError, MAX_PEOPLE, EMAIL_SHAPE,
  type Person, type Role, type ShareRole, type SharedProject,
  SITE_SLUG, type CloudAdapter, type CloudProject, type CloudUser, type CloudVersion, type LoadedProject, type SiteInfo, type Submission, type Usage,
} from "./types";

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

type Row = { id: string; owner: string; ownerEmail?: string; name: string; json: Project; version: number; updatedAt: string };
type VersionRow = { id: string; projectId: string; owner: string; version: number; json: Project; reason: string; createdAt: string };
type AssetRow = { asset: Asset; owner: string; b64: string };
type SiteRow = { projectId: string; owner: string; slug: string };
type SubRow = { id: string; slug: string; formId: string; fields: Record<string, string>; createdAt: string };
type MemberRow = { projectId: string; userId: string; email: string; role: ShareRole; addedBy: string; createdAt: string };
type InviteRow = { projectId: string; email: string; role: ShareRole; invitedBy: string; createdAt: string };
type Db = { session: CloudUser | null; projects: Row[]; versions: VersionRow[]; assets: AssetRow[]; sites?: SiteRow[]; submissions?: SubRow[]; members?: MemberRow[]; invites?: InviteRow[] };
const INVITE_DAYS = 30;

const KEY = "avc:mockcloud:v1";
const MAX_VERSIONS = 30;
export const LIMITS = { projects: 25, storageBytes: 200 * 1024 * 1024 } as const; // same numbers as migration 4

async function toB64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (b64: string, mime: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime });

/**
 * In-memory/KV-backed stand-in with the same observable rules as the SQL migration:
 * owner scoping, optimistic concurrency, 30-snapshot retention, unique asset per owner.
 * State lives in a key-value store (localStorage in the browser) so two tabs share one "server".
 */
import { QUOTA_PROJECTS, QUOTA_STORAGE } from "./types";
export function createMemoryAdapter(kv: KV): CloudAdapter {
  const listeners = new Set<(u: CloudUser | null) => void>();
  const load = (): Db => {
    try {
      const raw = kv.getItem(KEY);
      if (raw) return JSON.parse(raw) as Db;
    } catch {
      /* fall through to empty */
    }
    return { session: null, projects: [], versions: [], assets: [] };
  };
  const save = (db: Db) => kv.setItem(KEY, JSON.stringify(db));
  const me = (db: Db) => {
    if (!db.session) throw new CloudError("You are not signed in.");
    return db.session.id;
  };
  // ---- who may do what (the same rules as the SQL migration) ----
  const roleOf = (db: Db, projectId: string, uid: string): Role | null => {
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return null;
    if (p.owner === uid) return "owner";
    return (db.members ?? []).find((m) => m.projectId === projectId && m.userId === uid)?.role ?? null;
  };
  const visibleProjects = (db: Db, uid: string) => db.projects.filter((p) => roleOf(db, p.id, uid) !== null);
  const participants = (db: Db, p: Row) => new Set([p.owner, ...(db.members ?? []).filter((m) => m.projectId === p.id).map((m) => m.userId)]);
  /** Pictures I own, plus pictures used by a project I can see that belong to someone taking part in it. */
  const visibleAssets = (db: Db, uid: string): AssetRow[] => {
    const projects = visibleProjects(db, uid).map((p) => ({ p, text: JSON.stringify(p.json), who: participants(db, p) }));
    return db.assets.filter((a) => a.owner === uid || projects.some(({ text, who }) => who.has(a.owner) && text.includes(a.asset.id)));
  };
  const check = (p: unknown): Project => {
    const v = validateProject(p);
    if (!v.ok) throw new CloudError("The project data is invalid and was not saved.");
    return v.project;
  };

  return {
    kind: "memory",

    async user() {
      return load().session;
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signInWithEmail(email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CloudError("Enter a valid email address.");
      const db = load();
      // Deterministic id per email so a "second device" with the same email is the same user.
      db.session = { id: `user_${[...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}`, email };
      save(db);
      listeners.forEach((l) => l(db.session));
    },
    async accessToken() {
      const s = load().session;
      return s ? `mock.${s.id}` : null; // dev/test only: the matching server check refuses this in production
    },
    async signOut() {
      const db = load();
      db.session = null;
      save(db);
      listeners.forEach((l) => l(null));
    },

    async listProjects() {
      const db = load();
      const uid = me(db);
      return db.projects
        .filter((p) => p.owner === uid)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map<CloudProject>((p) => ({ id: p.id, name: p.name, version: p.version, updatedAt: p.updatedAt }));
    },
    async createProject(project) {
      const db = load();
      const uid = me(db);
      const json = check(project);
      if (db.projects.filter((p) => p.owner === uid).length >= LIMITS.projects) throw new CloudError(QUOTA_PROJECTS);
      const id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      db.projects.push({ id, owner: uid, ownerEmail: db.session!.email, name: json.name, json, version: 1, updatedAt: new Date().toISOString() });
      save(db);
      return { id, version: 1 };
    },
    async loadProject(id): Promise<LoadedProject> {
      const db = load();
      const uid = me(db);
      const role = roleOf(db, id, uid);
      const row = db.projects.find((p) => p.id === id);
      if (!row || !role) throw new NotFoundError();
      return { id: row.id, name: row.name, version: row.version, project: check(row.json), role };
    },
    async saveProject(id, baseVersion, project) {
      const db = load();
      const uid = me(db);
      const json = check(project);
      const role = roleOf(db, id, uid);
      const row = db.projects.find((p) => p.id === id);
      if (!row || !role) throw new NotFoundError();
      if (role === "viewer") throw new ReadOnlyError();
      if (row.version !== baseVersion) throw new ConflictError();
      row.json = json;
      row.name = json.name;
      row.version += 1;
      row.updatedAt = new Date().toISOString();
      save(db);
      return { version: row.version };
    },
    async deleteProject(id) {
      const db = load();
      const uid = me(db);
      const owned = db.projects.some((p) => p.id === id && p.owner === uid);
      if (!owned) return; // anyone else: nothing is deleted (same as the database)
      db.projects = db.projects.filter((p) => p.id !== id);
      db.versions = db.versions.filter((v) => v.projectId !== id);
      db.members = (db.members ?? []).filter((m) => m.projectId !== id);
      db.invites = (db.invites ?? []).filter((i) => i.projectId !== id);
      save(db);
    },

    async claimInvites() {
      const db = load();
      const me_ = db.session;
      if (!me_) return 0;
      const email = me_.email.toLowerCase();
      const cutoff = Date.now() - INVITE_DAYS * 86_400_000;
      db.invites = (db.invites ?? []).filter((i) => Date.parse(i.createdAt) >= cutoff); // invitations expire
      let n = 0;
      for (const inv of db.invites.filter((i) => i.email === email)) {
        const proj = db.projects.find((p) => p.id === inv.projectId);
        if (!proj || proj.owner === me_.id) continue; // never a member of your own project
        const members = (db.members ??= []);
        const have = members.find((m) => m.projectId === inv.projectId && m.userId === me_.id);
        if (have) have.role = inv.role;
        else members.push({ projectId: inv.projectId, userId: me_.id, email: me_.email, role: inv.role, addedBy: inv.invitedBy, createdAt: new Date().toISOString() });
        n++;
      }
      db.invites = db.invites.filter((i) => i.email !== email);
      save(db);
      return n;
    },
    async listShared(): Promise<SharedProject[]> {
      const db = load();
      const uid = me(db);
      const out: SharedProject[] = [];
      for (const m of db.members ?? []) {
        if (m.userId !== uid) continue;
        const p = db.projects.find((x) => x.id === m.projectId);
        if (!p) continue;
        out.push({ id: p.id, name: p.name, version: p.version, updatedAt: p.updatedAt, role: m.role, ownerEmail: p.ownerEmail ?? "" });
      }
      return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async shareProject(projectId, email, role) {
      const db = load();
      const uid = me(db);
      if (role !== "editor" && role !== "viewer") throw new CloudError("Choose editor or viewer.");
      const e = email.trim().toLowerCase();
      if (e.length > 254 || !EMAIL_SHAPE.test(e)) throw new CloudError("Enter a valid email address.");
      if (roleOf(db, projectId, uid) !== "owner") throw new CloudError("Only the project's owner can do that.");
      if (db.session!.email.toLowerCase() === e) throw new CloudError("That's your own email address.");
      const invites = (db.invites ??= []);
      const members = db.members ?? [];
      const others = invites.filter((i) => i.projectId === projectId && i.email !== e).length;
      if (members.filter((m) => m.projectId === projectId).length + others >= MAX_PEOPLE) throw new CloudError("A project can be shared with up to 10 people. Remove someone first.");
      const have = invites.find((i) => i.projectId === projectId && i.email === e);
      const now = new Date().toISOString();
      if (have) Object.assign(have, { role, invitedBy: uid, createdAt: now });
      else invites.push({ projectId, email: e, role, invitedBy: uid, createdAt: now });
      save(db);
    },
    async listPeople(projectId): Promise<Person[]> {
      const db = load();
      const uid = me(db);
      if (roleOf(db, projectId, uid) !== "owner") throw new CloudError("Only the project's owner can do that.");
      const members: Person[] = (db.members ?? []).filter((m) => m.projectId === projectId).map((m) => ({ kind: "member", userId: m.userId, email: m.email, role: m.role, createdAt: m.createdAt }));
      const invited: Person[] = (db.invites ?? []).filter((i) => i.projectId === projectId).map((i) => ({ kind: "invited", email: i.email, role: i.role, createdAt: i.createdAt }));
      return [...members, ...invited].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async unshare(projectId, target) {
      const db = load();
      const uid = me(db);
      if (roleOf(db, projectId, uid) !== "owner") throw new CloudError("Only the project's owner can do that.");
      if (target.userId) db.members = (db.members ?? []).filter((m) => !(m.projectId === projectId && m.userId === target.userId));
      if (target.email) db.invites = (db.invites ?? []).filter((i) => !(i.projectId === projectId && i.email === target.email!.trim().toLowerCase()));
      save(db);
    },
    async leaveProject(projectId) {
      const db = load();
      const uid = me(db);
      db.members = (db.members ?? []).filter((m) => !(m.projectId === projectId && m.userId === uid));
      save(db);
    },
    async projectVersion(projectId) {
      const db = load();
      const uid = me(db);
      if (roleOf(db, projectId, uid) === null) return null;
      return db.projects.find((p) => p.id === projectId)?.version ?? null;
    },

    async snapshot(id, reason) {
      const db = load();
      const uid = me(db);
      const role = roleOf(db, id, uid);
      const row = db.projects.find((p) => p.id === id);
      if (!row || !role) throw new NotFoundError();
      if (role === "viewer") throw new ReadOnlyError();
      db.versions = db.versions.filter((v) => !(v.projectId === id && v.version === row.version));
      db.versions.push({ id: `ver_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, projectId: id, owner: row.owner, version: row.version, json: row.json, reason: reason.slice(0, 120), createdAt: new Date().toISOString() });
      // Newest first; version breaks ties so snapshots taken within the same millisecond are ordered deterministically.
      const mine = db.versions.filter((v) => v.projectId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
      const drop = new Set(mine.slice(MAX_VERSIONS).map((v) => v.id));
      db.versions = db.versions.filter((v) => !drop.has(v.id));
      save(db);
    },
    async listVersions(id) {
      const db = load();
      const uid = me(db);
      return db.versions
        .filter((v) => v.projectId === id && roleOf(db, id, uid) !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version)
        .map<CloudVersion>((v) => ({ id: v.id, version: v.version, reason: v.reason, createdAt: v.createdAt }));
    },
    async loadVersion(projectId, versionId) {
      const db = load();
      const uid = me(db);
      const v = db.versions.find((x) => x.id === versionId && x.projectId === projectId && roleOf(db, projectId, uid) !== null);
      if (!v) throw new NotFoundError("version");
      return check(v.json);
    },

    async listAssets() {
      const db = load();
      const uid = me(db);
      // One entry per picture (two accounts can hold the same one), preferring my own copy
      const byId = new Map<string, AssetRow>();
      for (const a of visibleAssets(db, uid)) if (!byId.has(a.asset.id) || (a.owner === uid && byId.get(a.asset.id)!.owner !== uid)) byId.set(a.asset.id, a);
      return [...byId.values()].map((a) => a.asset);
    },
    async uploadAsset(asset, blob) {
      const db = load();
      const uid = me(db);
      if (db.assets.some((a) => a.owner === uid && (a.asset.id === asset.id || a.asset.hash === asset.hash))) return; // idempotent
      if (db.assets.filter((a) => a.owner === uid).reduce((n, a) => n + a.asset.bytes, 0) + asset.bytes > LIMITS.storageBytes) throw new CloudError(QUOTA_STORAGE);
      db.assets.push({ asset, owner: uid, b64: await toB64(blob) });
      save(db);
    },
    async downloadAsset(asset) {
      const db = load();
      const uid = me(db);
      const copies = visibleAssets(db, uid).filter((a) => a.asset.id === asset.id);
      const row = copies.find((a) => a.owner === uid) ?? copies[0]; // my own copy first
      if (!row) throw new NotFoundError("file");
      return fromB64(row.b64, asset.mime);
    },
    async updateAssetAlt(id, alt) {
      if (alt.length > 300) throw new CloudError("The description is too long (300 characters at most).");
      const db = load();
      const uid = me(db);
      const row = db.assets.find((a) => a.asset.id === id && a.owner === uid);
      if (!row) throw new NotFoundError("file");
      row.asset = { ...row.asset, alt };
      save(db);
    },
    async deleteAsset(id) {
      const db = load();
      const uid = me(db);
      db.assets = db.assets.filter((a) => !(a.asset.id === id && a.owner === uid));
      save(db);
    },

    async getSite(projectId): Promise<SiteInfo | null> {
      const db = load();
      const uid = me(db);
      const s = (db.sites ?? []).find((x) => x.projectId === projectId && x.owner === uid);
      return s ? { slug: s.slug, formsEnabled: true } : null;
    },
    async saveSite(projectId, slug): Promise<SiteInfo> {
      const db = load();
      const uid = me(db);
      if (!SITE_SLUG.test(slug)) throw new CloudError("Use 3 to 40 lowercase letters, numbers or hyphens (not at the start or end).");
      if (!db.projects.some((p) => p.id === projectId && p.owner === uid)) throw new NotFoundError();
      const sites = (db.sites ??= []);
      if (sites.some((s) => s.slug === slug && s.projectId !== projectId)) throw new CloudError("That site name is already taken. Try another.");
      const mine = sites.find((s) => s.projectId === projectId);
      if (mine) mine.slug = slug;
      else sites.push({ projectId, owner: uid, slug });
      save(db);
      return { slug, formsEnabled: true };
    },
    async listSubmissions(projectId): Promise<Submission[]> {
      const db = load();
      const uid = me(db);
      const site = (db.sites ?? []).find((s) => s.projectId === projectId && s.owner === uid);
      if (!site) return [];
      return (db.submissions ?? []).filter((s) => s.slug === site.slug).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200)
        .map((s) => ({ id: s.id, formId: s.formId, fields: s.fields, createdAt: s.createdAt }));
    },
    async getUsage(): Promise<Usage> {
      const db = load();
      const uid = me(db);
      return {
        projects: db.projects.filter((p) => p.owner === uid).length, projectsLimit: LIMITS.projects,
        storageBytes: db.assets.filter((a) => a.owner === uid).reduce((n, a) => n + a.asset.bytes, 0), storageLimit: LIMITS.storageBytes,
      };
    },
    async deleteAccount() {
      const db = load();
      const uid = me(db);
      const mine = new Set((db.sites ?? []).filter((s) => s.owner === uid).map((s) => s.slug));
      const ids = new Set(db.projects.filter((p) => p.owner === uid).map((p) => p.id));
      db.projects = db.projects.filter((p) => p.owner !== uid);
      db.versions = db.versions.filter((v) => v.owner !== uid && !ids.has(v.projectId));
      db.assets = db.assets.filter((a) => a.owner !== uid);
      db.members = (db.members ?? []).filter((m) => m.userId !== uid && !ids.has(m.projectId));
      db.invites = (db.invites ?? []).filter((i) => i.invitedBy !== uid && !ids.has(i.projectId));
      db.sites = (db.sites ?? []).filter((s) => s.owner !== uid);
      db.submissions = (db.submissions ?? []).filter((s) => !mine.has(s.slug));
      db.session = null;
      save(db);
      listeners.forEach((l) => l(null));
    },
    async deleteSubmission(id) {
      const db = load();
      const uid = me(db);
      const mine = new Set((db.sites ?? []).filter((s) => s.owner === uid).map((s) => s.slug));
      db.submissions = (db.submissions ?? []).filter((s) => !(s.id === id && mine.has(s.slug)));
      save(db);
    },
  };
}
