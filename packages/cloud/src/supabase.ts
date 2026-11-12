import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateProject, type Asset, type Project } from "@avc/schema";
import {
  CloudError, ConflictError, NotFoundError, ReadOnlyError,
  type Person, type Role, type ShareRole, type SharedProject,
  SITE_SLUG, type CloudAdapter, type CloudProject, type CloudUser, type CloudVersion, type SiteInfo, type Submission, type Usage, QUOTA_PROJECTS, QUOTA_STORAGE,
} from "./types";

type DbError = { code?: string; message?: string; statusCode?: string | number } | null | undefined;

/** Postgres/PostgREST error -> a typed error with a message that is safe to show. Raw SQL text is never surfaced. */
export function mapError(error: NonNullable<DbError>, what = "project"): Error {
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "");
  if (/quota_projects/.test(msg)) return new CloudError(QUOTA_PROJECTS);
  if (/quota_storage/.test(msg)) return new CloudError(QUOTA_STORAGE);
  if (/quota_submissions/.test(msg)) return new CloudError("This site's message inbox is full. Delete some messages to make room.");
  if (/read_only/.test(msg)) return new ReadOnlyError();
  if (/too_many_people/.test(msg)) return new CloudError("A project can be shared with up to 10 people. Remove someone first.");
  if (/cannot_share_with_self/.test(msg)) return new CloudError("That's your own email address.");
  if (/bad_email/.test(msg)) return new CloudError("Enter a valid email address.");
  if (/bad_role/.test(msg)) return new CloudError("Choose editor or viewer.");
  if (/not_owner/.test(msg)) return new CloudError("Only the project's owner can do that.");
  if (code === "40001" || /version_conflict/.test(msg)) return new ConflictError();
  if (code === "P0002" || code === "PGRST116" || /not_found/.test(msg)) return new NotFoundError(what);
  if (code === "23514") return new CloudError("That data was rejected as invalid.");
  if (code === "42501" || /row-level security/i.test(msg)) return new CloudError("You don't have permission to do that.");
  if (/JWT|not authenticated/i.test(msg)) return new CloudError("Your session expired. Please sign in again.");
  return new CloudError("Something went wrong talking to the server. Please try again.");
}

// owner_id lets us tell my own row from someone else's when two accounts hold the same picture (same id).
const ASSET_COLUMNS_V1 = "id, owner_id, name, kind, mime, bytes, width, height, hash, alt, created_at";
const ASSET_COLUMNS_V2 = `${ASSET_COLUMNS_V1}, derived_from_asset, derived_op`;

/** Postgres "undefined column" / PostgREST "column not in schema cache": the database has not had migration 2 yet. */
const isMissingColumn = (e: DbError) => String(e?.code ?? "") === "42703" || String(e?.code ?? "") === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(String(e?.message ?? ""));
const toAsset = (r: any): Asset => ({
  id: r.id, name: r.name, kind: r.kind, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height,
  hash: r.hash, alt: r.alt ?? undefined, createdAt: Date.parse(r.created_at),
  ...(r.derived_from_asset && (r.derived_op === "rotate" || r.derived_op === "crop") ? { derivedFrom: { assetId: r.derived_from_asset, op: r.derived_op } } : {}),
});

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}

export function createSupabaseAdapter(client: SupabaseClient, opts: { redirectTo?: string } = {}): CloudAdapter {
  // Newer columns are used when the database has them, and quietly skipped when it does not, so the editor keeps working
  // between deploying new code and applying the matching migration.
  let derivedColumns = true;
  // true until we learn the database hasn't had migration 7 (asset rows keyed by owner + id); then the old key (id alone) is used
  let perOwnerKey = true;
  const toUser = (u: { id: string; email?: string | null } | null | undefined): CloudUser | null => (u ? { id: u.id, email: u.email ?? "" } : null);
  const uid = async (): Promise<string> => {
    const { data } = await client.auth.getSession();
    if (!data.session) throw new CloudError("You are not signed in.");
    return data.session.user.id;
  };
  const ok = <T>(res: { data: T | null; error: DbError }, what?: string): T => {
    if (res.error) throw mapError(res.error, what);
    return res.data as T;
  };
  /** Anything coming back from the database is untrusted until it passes the same validator the editor uses. */
  const checked = (json: unknown): Project => {
    const v = validateProject(json);
    if (!v.ok) throw new CloudError("This project's saved data is invalid and can't be opened.");
    return v.project;
  };

  return {
    kind: "supabase",

    async user() {
      const { data } = await client.auth.getSession();
      return toUser(data.session?.user);
    },
    onAuthChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signInWithEmail(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: opts.redirectTo } });
      if (error) throw new CloudError(/rate limit/i.test(error.message) ? "Too many attempts. Please wait a minute and try again." : "Could not send the sign-in email. Check the address and try again.");
    },
    async accessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new CloudError("Could not sign out. Please try again.");
    },

    async listProjects() {
      const rows = ok<any[]>(await client.from("projects").select("id, name, version, updated_at").order("updated_at", { ascending: false }));
      return rows.map<CloudProject>((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at }));
    },
    async createProject(project) {
      const owner = await uid();
      const row = ok<any>(
        await client.from("projects").insert({ owner_id: owner, name: project.name, platform: project.platform, json: project }).select("id, version").single(),
      );
      return { id: row.id, version: row.version };
    },
    async loadProject(id) {
      const row = ok<any>(await client.from("projects").select("id, name, version, json").eq("id", id).single());
      // Before the sharing migration is applied only the owner can open a project, so "owner" is the right answer when the question can't be asked.
      const r = await client.rpc("project_role", { p_project: id });
      const role: Role = !r.error && (r.data === "editor" || r.data === "viewer" || r.data === "owner") ? r.data : "owner";
      return { id: row.id, name: row.name, version: row.version, project: checked(row.json), role };
    },

    async claimInvites() {
      const res = await client.rpc("claim_invites");
      if (res.error) return 0; // migration 6 not applied yet: nothing to claim
      return typeof res.data === "number" ? res.data : 0;
    },
    async listShared(): Promise<SharedProject[]> {
      const res = await client.rpc("shared_with_me");
      if (res.error) return [];
      return ((res.data ?? []) as any[])
        .filter((r) => r.role === "editor" || r.role === "viewer")
        .map((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at, role: r.role as ShareRole, ownerEmail: String(r.owner_email ?? "") }));
    },
    async shareProject(projectId, email, role) {
      ok(await client.rpc("share_project", { p_project: projectId, p_email: email, p_role: role }));
    },
    async listPeople(projectId): Promise<Person[]> {
      const rows = ok<any[]>(await client.rpc("project_people", { p_project: projectId }));
      return rows
        .filter((r) => (r.kind === "member" || r.kind === "invited") && (r.role === "editor" || r.role === "viewer"))
        .map((r) => ({ kind: r.kind, userId: r.user_id ?? undefined, email: String(r.email ?? ""), role: r.role, createdAt: r.created_at }));
    },
    async unshare(projectId, target) {
      ok(await client.rpc("unshare_project", { p_project: projectId, p_user: target.userId ?? null, p_email: target.email ?? null }));
    },
    async leaveProject(projectId) {
      ok(await client.rpc("leave_project", { p_project: projectId }));
    },
    async projectVersion(projectId) {
      const res = await client.from("projects").select("version").eq("id", projectId).maybeSingle();
      if (res.error || !res.data) return null;
      return typeof (res.data as any).version === "number" ? (res.data as any).version : null;
    },
    async saveProject(id, baseVersion, project) {
      const rows = ok<any[]>(await client.rpc("save_project", { p_id: id, p_base_version: baseVersion, p_json: project, p_name: project.name }));
      const first = Array.isArray(rows) ? rows[0] : rows;
      if (!first || typeof first.version !== "number") throw new CloudError("The server returned an unexpected response.");
      return { version: first.version };
    },
    async deleteProject(id) {
      ok(await client.from("projects").delete().eq("id", id));
    },

    async snapshot(id, reason) {
      ok(await client.rpc("snapshot_project", { p_id: id, p_reason: reason }));
    },
    async listVersions(id) {
      const rows = ok<any[]>(await client.from("project_versions").select("id, version, reason, created_at").eq("project_id", id).order("created_at", { ascending: false }));
      return rows.map<CloudVersion>((r) => ({ id: r.id, version: r.version, reason: r.reason, createdAt: r.created_at }));
    },
    async loadVersion(projectId, versionId) {
      const row = ok<any>(await client.from("project_versions").select("json").eq("project_id", projectId).eq("id", versionId).single(), "version");
      return checked(row.json);
    },

    async listAssets() {
      let res = await client.from("assets").select(derivedColumns ? ASSET_COLUMNS_V2 : ASSET_COLUMNS_V1);
      if (res.error && derivedColumns && isMissingColumn(res.error)) {
        derivedColumns = false;
        res = await client.from("assets").select(ASSET_COLUMNS_V1);
      }
      // Two accounts can hold the same picture (the id comes from the file's content). Show it once, preferring my own copy.
      const me = (await client.auth.getSession()).data.session?.user.id;
      const rows = ok<any[]>(res as never);
      const byId = new Map<string, any>();
      for (const r of rows) if (!byId.has(r.id) || (r.owner_id === me && byId.get(r.id).owner_id !== me)) byId.set(r.id, r);
      return [...byId.values()].map(toAsset);
    },
    async uploadAsset(asset, blob) {
      const owner = await uid();
      const key = `${owner}/${asset.id}`;
      const up = await client.storage.from("assets").upload(key, blob, { contentType: asset.mime, upsert: false });
      // 409 / "already exists": the same bytes were uploaded before. IDs derive from the hash, so that is success.
      if (up.error && !(String((up.error as DbError)?.statusCode) === "409" || /already exists|Duplicate/i.test(up.error.message))) {
        throw new CloudError("Could not upload that file. Please try again.");
      }
      const row = { id: asset.id, owner_id: owner, name: asset.name, kind: asset.kind, mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height, hash: asset.hash, alt: asset.alt ?? null, storage_key: key };
      const withDerived = { ...row, derived_from_asset: asset.derivedFrom?.assetId ?? null, derived_op: asset.derivedFrom?.op ?? null };
      // Each account holds its own row for a picture (key: owner + id). A database that hasn't had migration 7 yet only knows the
      // old key (id alone): fall back to it, so the editor keeps working between deploying this code and applying the migration.
      const put = async (payload: object) => {
        let r = await client.from("assets").upsert(payload, { onConflict: perOwnerKey ? "owner_id,id" : "id", ignoreDuplicates: false });
        if (r.error && perOwnerKey && String(r.error.code ?? "") === "42P10") {
          perOwnerKey = false;
          r = await client.from("assets").upsert(payload, { onConflict: "id", ignoreDuplicates: false });
        }
        return r;
      };
      let res = await put(derivedColumns ? withDerived : row);
      if (res.error && derivedColumns && isMissingColumn(res.error)) {
        derivedColumns = false;
        res = await put(row);
      }
      if (res.error) {
        // Same bytes under another id (older, random-id uploads): the library already has them.
        if (res.error.code === "23505") return;
        // Someone else already holds this exact picture and it is visible to me through a shared project: it is there, which is all that matters.
        if (res.error.code === "42501") {
          const have = await client.from("assets").select("id").eq("id", asset.id).maybeSingle();
          if (have.data) return;
        }
        throw mapError(res.error, "file");
      }
    },
    async downloadAsset(asset) {
      // A picture used in a shared project may live in someone else's folder: ask the library where it is (row security decides who may).
      const me = await uid();
      const found = await client.from("assets").select("storage_key, owner_id").eq("id", asset.id);
      const rows = ((found.data ?? []) as { storage_key?: string; owner_id?: string }[]).filter((r) => typeof r.storage_key === "string");
      // The same picture can be held by several accounts: my own copy first, otherwise any copy I'm allowed to see.
      const key = (rows.find((r) => r.owner_id === me) ?? rows[0])?.storage_key ?? `${me}/${asset.id}`;
      const { data, error } = await client.storage.from("assets").download(key);
      if (error || !data) throw new NotFoundError("file");
      return data;
    },
    async updateAssetAlt(id, alt) {
      if (alt.length > 300) throw new CloudError("The description is too long (300 characters at most).");
      ok(await client.from("assets").update({ alt }).eq("id", id), "file");
    },
    async deleteAsset(id) {
      const owner = await uid();
      const rm = await client.storage.from("assets").remove([`${owner}/${id}`]);
      if (rm.error) throw new CloudError("Could not delete that file. Please try again.");
      ok(await client.from("assets").delete().eq("id", id));
    },

    async getSite(projectId): Promise<SiteInfo | null> {
      const res = await client.from("sites").select("slug, forms_enabled").eq("project_id", projectId).maybeSingle();
      const row = ok<any>(res as never, "site");
      return row ? { slug: row.slug, formsEnabled: !!row.forms_enabled } : null;
    },
    async saveSite(projectId, slug): Promise<SiteInfo> {
      if (!SITE_SLUG.test(slug)) throw new CloudError("Use 3 to 40 lowercase letters, numbers or hyphens (not at the start or end).");
      const owner = await uid();
      const res = await client.from("sites").upsert({ owner_id: owner, project_id: projectId, slug }, { onConflict: "project_id" }).select("slug, forms_enabled").single();
      if (res.error?.code === "23505") throw new CloudError("That site name is already taken. Try another.");
      const row = ok<any>(res as never, "site");
      return { slug: row.slug, formsEnabled: !!row.forms_enabled };
    },
    async listSubmissions(projectId): Promise<Submission[]> {
      const res = await client.from("form_submissions").select("id, form_id, payload, created_at, sites!inner(project_id)").eq("sites.project_id", projectId).order("created_at", { ascending: false }).limit(200);
      return ok<any[]>(res as never, "site").map((r) => ({
        id: r.id, formId: r.form_id, createdAt: r.created_at,
        // untrusted: keep only string values
        fields: Object.fromEntries(Object.entries(r.payload ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>,
      }));
    },
    async getUsage(): Promise<Usage | null> {
      const res = await client.rpc("my_usage");
      // Migration 4 not applied yet (function missing): there is simply nothing to show.
      if (res.error) return null;
      const u = res.data as any;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
      const out = { projects: n(u?.projects), projectsLimit: n(u?.projectsLimit), storageBytes: n(u?.storageBytes), storageLimit: n(u?.storageLimit) };
      return Object.values(out).every((v) => v !== null) ? (out as Usage) : null;
    },
    async deleteAccount() {
      const token = (await client.auth.getSession()).data.session?.access_token;
      if (!token) throw new CloudError("You are not signed in.");
      let res: Response;
      try {
        res = await fetch("/api/account", { method: "DELETE", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
      } catch {
        throw new CloudError("Couldn't reach the server. Nothing was deleted.");
      }
      if (!res.ok) throw new CloudError("Couldn't delete the account. Nothing was lost; please try again.");
      await client.auth.signOut().catch(() => {});
    },
    async deleteSubmission(id) {
      ok(await client.from("form_submissions").delete().eq("id", id));
    },
  };
}
