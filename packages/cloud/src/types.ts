import type { Asset, Project } from "@avc/schema";

export type CloudUser = { id: string; email: string };
export type CloudProject = { id: string; name: string; version: number; updatedAt: string };
export type CloudVersion = { id: string; version: number; reason: string; createdAt: string };
/** A published site's public name. It is what visitors' form submissions are filed under. */
export type SiteInfo = { slug: string; formsEnabled: boolean };
/** One message a visitor sent through a contact form. Values are plain text: always render them escaped. */
export type Submission = { id: string; formId: string; fields: Record<string, string>; createdAt: string };
/** 3 to 40 lowercase letters, digits or hyphens, not starting or ending with a hyphen (matches the database rule). */
export const SITE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const QUOTA_PROJECTS = "You've reached the limit of 25 projects. Delete one you no longer need to make room.";
export const QUOTA_STORAGE = "Your media storage is full (200 MB). Delete some images from the library to make room.";

/** What an account is using against its limits. */
export type Usage = { projects: number; projectsLimit: number; storageBytes: number; storageLimit: number };

/** What the signed-in person may do with a project: the owner can do everything; an editor can change it; a viewer can only look. */
export type Role = "owner" | "editor" | "viewer";
export type ShareRole = "editor" | "viewer";
/** A project someone else shared with me. */
export type SharedProject = { id: string; name: string; version: number; updatedAt: string; role: ShareRole; ownerEmail: string };
/** Someone with access to a project (member), or an invitation nobody has accepted yet (invited). Only the owner can list these. */
export type Person = { kind: "member" | "invited"; userId?: string; email: string; role: ShareRole; createdAt: string };
export const MAX_PEOPLE = 10;
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type LoadedProject = { id: string; name: string; version: number; project: Project; role: Role };

/** Someone else saved a newer version since this client last loaded or saved (HTTP 409 in spec section 13). */
export class ConflictError extends Error {
  constructor() {
    super("The project was changed somewhere else.");
    this.name = "ConflictError";
  }
}
/** Saving was refused because the person only has view access. Nothing was changed. */
export class ReadOnlyError extends Error {
  constructor() {
    super("You only have view access to this project, so changes can't be saved.");
    this.name = "ReadOnlyError";
  }
}
export class NotFoundError extends Error {
  constructor(what = "project") {
    super(`That ${what} no longer exists, or you don't have access to it.`);
    this.name = "NotFoundError";
  }
}
/** Anything else: network, permissions, invalid data. The message is safe to show to the user. */
export class CloudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudError";
  }
}

/**
 * Everything the editor needs from a backend. The Supabase adapter is the real one; the memory adapter
 * implements the same contract for tests and offline demos, so the editor never imports a vendor SDK.
 */
export interface CloudAdapter {
  readonly kind: "supabase" | "memory";

  // auth
  user(): Promise<CloudUser | null>;
  onAuthChange(cb: (user: CloudUser | null) => void): () => void;
  /** Passwordless: sends a sign-in link. Resolves when the email has been requested. */
  signInWithEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Credential to send to our own server (never to a third party). Null when signed out. */
  accessToken(): Promise<string | null>;

  // projects
  listProjects(): Promise<CloudProject[]>;
  createProject(project: Project): Promise<{ id: string; version: number }>;
  loadProject(id: string): Promise<LoadedProject>;
  /** Saves only if `baseVersion` is still current; otherwise throws ConflictError and changes nothing. */
  saveProject(id: string, baseVersion: number, project: Project): Promise<{ version: number }>;
  deleteProject(id: string): Promise<void>;

  // sharing (spec Phase 5: collaboration). Sharing is an invitation; the invitee accepts it by calling claimInvites() after signing in.
  /** Turns any invitations for my verified email into access. Cheap; call it after sign-in and whenever the app opens. Returns how many projects were added. */
  claimInvites(): Promise<number>;
  listShared(): Promise<SharedProject[]>;
  /** Owner only. Never reveals whether the email already has an account. */
  shareProject(projectId: string, email: string, role: ShareRole): Promise<void>;
  /** Owner only: members and pending invitations. */
  listPeople(projectId: string): Promise<Person[]>;
  /** Owner only: remove a member (by user id) or withdraw an invitation (by email). */
  unshare(projectId: string, target: { userId?: string; email?: string }): Promise<void>;
  /** Stop having access to a project someone shared with me. */
  leaveProject(projectId: string): Promise<void>;
  /** The project's current saved version, or null if it is gone or no longer visible. Used to notice that someone else saved. */
  projectVersion(projectId: string): Promise<number | null>;

  // history
  snapshot(id: string, reason: string): Promise<void>;
  listVersions(id: string): Promise<CloudVersion[]>;
  loadVersion(projectId: string, versionId: string): Promise<Project>;

  // media
  listAssets(): Promise<Asset[]>;
  /** Idempotent: uploading an asset that already exists succeeds. */
  uploadAsset(asset: Asset, blob: Blob): Promise<void>;
  downloadAsset(asset: Asset): Promise<Blob>;
  /** Update the description of an existing library file (max 300 characters). */
  updateAssetAlt(id: string, alt: string): Promise<void>;
  deleteAsset(id: string): Promise<void>;

  // published site + contact-form inbox (the project must already be saved to the cloud)
  getSite(projectId: string): Promise<SiteInfo | null>;
  /** Creates the site record or renames it. Throws CloudError with a friendly message if the name is invalid or taken. */
  saveSite(projectId: string, slug: string): Promise<SiteInfo>;
  /** Newest first, at most 200. Only the site's owner can read these. */
  listSubmissions(projectId: string): Promise<Submission[]>;
  deleteSubmission(id: string): Promise<void>;

  // account
  /** Null when the backend does not report usage (for example, the quota migration has not been applied yet). */
  getUsage(): Promise<Usage | null>;
  /** Permanently deletes the account and everything in it, then signs out. The caller must have asked the person to confirm. */
  deleteAccount(): Promise<void>;
}
