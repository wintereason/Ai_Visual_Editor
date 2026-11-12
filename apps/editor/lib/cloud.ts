import { createMemoryAdapter, createSupabaseAdapter, createSupabaseClient, CloudError, ConflictError, NotFoundError, ReadOnlyError, type CloudAdapter, type CloudProject, type CloudUser, type CloudVersion, type Role, type SharedProject } from "@avc/cloud";
import type { Project } from "@avc/schema";
import { create } from "zustand";
import { getAllAssets, putAsset } from "./assets";
import { useEditor } from "./store";

const LINK_KEY = "avc:cloudlink:v1";

// ---- adapter selection (client only): mock for tests/demos, Supabase when configured, otherwise cloud features are hidden ----
let adapter: CloudAdapter | null | undefined;
export function getCloud(): CloudAdapter | null {
  if (adapter !== undefined) return adapter;
  if (typeof window === "undefined") return null;
  if (process.env.NEXT_PUBLIC_CLOUD === "mock") adapter = createMemoryAdapter(localStorage);
  else if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    adapter = createSupabaseAdapter(createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { redirectTo: window.location.origin });
  else adapter = null;
  return adapter;
}

// `hash` fingerprints the project content at the last successful sync, so after a reload we can tell
// "nothing changed locally" (safe to fast-forward) from "unsynced local edits" (must be pushed / may conflict).
type Link = { id: string; version: number; userId: string; hash?: string };
export function hashProject(p: Project): string {
  const str = JSON.stringify(p);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${str.length}:${h.toString(16)}`;
}
const readLink = (): Link | null => {
  try {
    const l = JSON.parse(localStorage.getItem(LINK_KEY) ?? "null");
    return l && typeof l.id === "string" && typeof l.version === "number" && typeof l.userId === "string" ? { ...l, hash: typeof l.hash === "string" ? l.hash : undefined } : null;
  } catch {
    return null;
  }
};
const writeLink = (l: Link | null) => {
  try {
    if (l) localStorage.setItem(LINK_KEY, JSON.stringify(l));
    else localStorage.removeItem(LINK_KEY);
  } catch {
    /* storage unavailable: the link just won't survive a reload */
  }
};

export type SyncState = "off" | "idle" | "syncing" | "synced" | "conflict" | "error";

type CloudState = {
  available: boolean;
  user: CloudUser | null;
  cloudId: string | null;
  cloudVersion: number;
  sync: SyncState;
  message: string | null;
  projects: CloudProject[];
  /** Projects other people shared with me. */
  shared: SharedProject[];
  /** What I may do with the open project. */
  role: Role;
  /** How many people (members + pending invitations) the open project is shared with. Only known to its owner. */
  peopleCount: number;
  /** A friendly, non-error note (for example "a project was shared with you"). */
  notice: string | null;
  projectsLoading: boolean;
  versions: CloudVersion[];
  versionsLoading: boolean;
  refreshVersions: () => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
  saveSnapshot: (label: string) => Promise<void>;
  init: () => Promise<void>;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveToCloud: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  pushSync: () => Promise<void>;
  resolveConflict: (choice: "reload" | "overwrite") => Promise<void>;
  unlink: () => void;
  clearMessage: () => void;
  clearNotice: () => void;
  setPeopleCount: (n: number) => void;
  leaveProject: (id: string) => Promise<void>;
  /** Looks for changes someone else saved to the open project, and brings them in (or flags a conflict if I have unsaved edits). */
  checkRemote: () => Promise<void>;
};

// Identity of the project object last known to match the server; lets us skip no-op pushes.
let lastSynced: Project | null = null;
let running = false;
let again = false;
let lastSnapshotAt = 0;
let unsubAuth: (() => void) | null = null;

// ---- collaboration ----
const POLL_MS = 15_000;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let watchTicks = 0;
const READ_ONLY_TEXT = "This project is view-only for you, so your changes were not saved. The saved version has been loaded.";

/** What I may do with the open project. A viewer's editor is locked: every change is refused. */
function applyRole(role: Role) {
  useCloud.setState({ role });
  useEditor.setState({ readOnly: role === "viewer" });
}
/** Watching for other people's saves only costs a request every few seconds, so it only runs while the open project is actually shared. */
function syncWatch() {
  const { cloudId, role, peopleCount, user } = useCloud.getState();
  const want = !!(cloudId && user && (role !== "owner" || peopleCount > 0));
  if (want && !watchTimer) watchTimer = setInterval(() => void useCloud.getState().checkRemote(), POLL_MS);
  if (!want && watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}
async function countPeople(id: string) {
  const cloud = getCloud();
  try {
    const n = cloud && useCloud.getState().role === "owner" ? (await cloud.listPeople(id)).length : 0;
    if (useCloud.getState().cloudId === id) { useCloud.setState({ peopleCount: n }); syncWatch(); }
  } catch { /* not shared, or sharing isn't set up on this server yet */ }
}
/** Accept any invitations waiting for my email and refresh the shared list. Quiet when sharing isn't available. */
async function afterSignIn() {
  const cloud = getCloud();
  if (!cloud) return;
  try {
    const n = await cloud.claimInvites();
    if (n > 0) useCloud.setState({ notice: n === 1 ? "A project was shared with you. Open it from Projects." : `${n} projects were shared with you. Open them from Projects.` });
    useCloud.setState({ shared: await cloud.listShared() });
  } catch { /* best effort */ }
}

const errText = (e: unknown, fallback: string) => (e instanceof CloudError || e instanceof NotFoundError ? e.message : fallback);

export const useCloud = create<CloudState>((set, get) => ({
  available: false,
  user: null,
  cloudId: null,
  cloudVersion: 0,
  sync: "off",
  message: null,
  projects: [],
  shared: [],
  role: "owner",
  peopleCount: 0,
  notice: null,
  projectsLoading: false,
  versions: [],
  versionsLoading: false,

  refreshVersions: async () => {
    const cloud = getCloud();
    const id = get().cloudId;
    if (!cloud || !id || !get().user) return set({ versions: [] });
    set({ versionsLoading: true });
    try {
      set({ versions: await cloud.listVersions(id), versionsLoading: false });
    } catch (e) {
      set({ versionsLoading: false, message: errText(e, "Could not load the cloud history.") });
    }
  },

  // Restoring replaces the open project with that version. It is an undoable change, and the result is then saved as a
  // new version on the server, so nothing in the history is ever overwritten or lost.
  restoreVersion: async (versionId) => {
    const cloud = getCloud();
    const id = get().cloudId;
    if (!cloud || !id) return;
    try {
      const project = await cloud.loadVersion(id, versionId);
      useEditor.getState().loadProject(project, "a cloud version");
      await get().pushSync();
      await get().refreshVersions();
    } catch (e) {
      set({ message: errText(e, "Could not restore that version.") });
    }
  },

  // A named version: make sure the server has the latest edits, then snapshot that state.
  saveSnapshot: async (label) => {
    const cloud = getCloud();
    const id = get().cloudId;
    if (!cloud || !id || get().sync === "conflict") return;
    try {
      await get().pushSync();
      await cloud.snapshot(id, label);
      await get().refreshVersions();
    } catch (e) {
      set({ message: errText(e, "Could not save a cloud version.") });
    }
  },

  init: async () => {
    const cloud = getCloud();
    if (!cloud) return;
    set({ available: true });
    unsubAuth?.();
    unsubAuth = cloud.onAuthChange((user) => {
      // Signed in but not linked to a cloud project yet: say so ("Not synced") instead of showing nothing.
      set({ user, ...(user && !get().cloudId ? { sync: "idle" as const } : {}) });
      if (user) { void syncAssets(); void afterSignIn(); }
      else {
        writeLink(null);
        lastSynced = null;
        applyRole("owner");
        set({ cloudId: null, cloudVersion: 0, sync: "off", projects: [], shared: [], peopleCount: 0, notice: null });
        syncWatch();
      }
    });
    try {
      const user = await cloud.user();
      set({ user, ...(user ? { sync: "idle" as const } : {}) });
      if (!user) return;
      void afterSignIn();
      const link = readLink();
      if (link && link.userId === user.id) {
        set({ cloudId: link.id, cloudVersion: link.version, sync: "idle" });
        // Was this project shared with me? Then I may only be allowed to look (or to edit), not own it.
        const sharedNow = await cloud.listShared().catch(() => [] as SharedProject[]);
        applyRole(sharedNow.find((s) => s.id === link.id)?.role ?? "owner");
        void countPeople(link.id);
        const local = useEditor.getState().project;
        if (link.hash && link.hash === hashProject(local)) {
          // No local edits since the last sync. Fast-forward if the server moved on; otherwise we are already in sync.
          lastSynced = local;
          try {
            const server = await cloud.loadProject(link.id);
            if (server.version > link.version) {
              useEditor.getState().loadProject(server.project, "the latest cloud version");
              useEditor.setState({ past: [], future: [] }); // never let Undo step back across someone else's changes
              lastSynced = useEditor.getState().project;
              writeLink({ id: link.id, version: server.version, userId: user.id, hash: hashProject(lastSynced) });
              set({ cloudVersion: server.version });
            }
            set({ sync: "synced" });
          } catch (e) {
            if (e instanceof NotFoundError) {
              get().unlink();
              set({ message: "This project was deleted or is no longer shared with you, so it's saved only on this device now." });
            } else set({ sync: "error", message: errText(e, "Couldn't reach the server.") });
          }
        } else void get().pushSync(); // unsynced local edits: push them (or surface a conflict)
      } else writeLink(null);
      void syncAssets();
    } catch (e) {
      set({ sync: "error", message: errText(e, "Could not reach the server.") });
    }
  },

  signIn: async (email) => {
    await getCloud()!.signInWithEmail(email.trim()); // errors carry user-safe messages; the dialog displays them
  },
  signOut: async () => {
    await getCloud()?.signOut();
  },

  saveToCloud: async () => {
    const cloud = getCloud();
    const user = get().user;
    if (!cloud || !user) return;
    set({ sync: "syncing", message: null });
    try {
      const project = useEditor.getState().project;
      const { id, version } = await cloud.createProject(project);
      lastSynced = project;
      writeLink({ id, version, userId: user.id, hash: hashProject(project) });
      applyRole("owner");
      set({ cloudId: id, cloudVersion: version, sync: "synced", peopleCount: 0 });
      syncWatch();
      void cloud.snapshot(id, "Created").catch(() => {});
      void syncAssets();
    } catch (e) {
      set({ sync: "error", message: errText(e, "Could not save to the cloud.") });
    }
  },

  openProject: async (id) => {
    const cloud = getCloud();
    const user = get().user;
    if (!cloud || !user) return;
    set({ sync: "syncing", message: null });
    try {
      const loaded = await cloud.loadProject(id);
      useEditor.getState().loadProject(loaded.project, `opening "${loaded.name}"`);
      lastSynced = useEditor.getState().project;
      writeLink({ id: loaded.id, version: loaded.version, userId: user.id, hash: hashProject(lastSynced) });
      applyRole(loaded.role);
      set({ cloudId: loaded.id, cloudVersion: loaded.version, sync: "synced", peopleCount: 0 });
      syncWatch();
      void countPeople(loaded.id);
      await syncAssets();
    } catch (e) {
      set({ sync: get().cloudId ? "idle" : "off", message: errText(e, "Could not open that project.") });
    }
  },

  deleteProject: async (id) => {
    try {
      await getCloud()!.deleteProject(id);
      if (get().cloudId === id) get().unlink();
      await get().refreshProjects();
    } catch (e) {
      set({ message: errText(e, "Could not delete that project.") });
    }
  },

  refreshProjects: async () => {
    const cloud = getCloud();
    if (!cloud || !get().user) return;
    set({ projectsLoading: true });
    try {
      await afterSignIn(); // picks up invitations that arrived while the app was open
      set({ projects: await cloud.listProjects(), projectsLoading: false });
    } catch (e) {
      set({ projectsLoading: false, message: errText(e, "Could not load your projects.") });
    }
  },

  // Called after each local autosave. Saves are serialized; edits made during a save trigger one more.
  pushSync: async () => {
    const cloud = getCloud();
    const { user, cloudId, sync } = get();
    if (!cloud || !user || !cloudId || sync === "conflict") return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const project = useEditor.getState().project;
        if (project === lastSynced) {
          set({ sync: "synced" });
          continue;
        }
        set({ sync: "syncing", message: null });
        const { version } = await cloud.saveProject(get().cloudId!, get().cloudVersion, project);
        lastSynced = project;
        writeLink({ id: get().cloudId!, version, userId: user.id, hash: hashProject(project) });
        set({ cloudVersion: version, sync: "synced" });
        if (Date.now() - lastSnapshotAt > 120_000) {
          lastSnapshotAt = Date.now();
          void cloud.snapshot(get().cloudId!, "Autosave").catch(() => {});
        }
      } while (again);
    } catch (e) {
      if (e instanceof ReadOnlyError) {
        // Access was reduced to view-only after this person started editing. Their unsaved edits are not lost: Undo brings them back.
        applyRole("viewer");
        try {
          const server = await cloud.loadProject(get().cloudId!);
          useEditor.getState().loadProject(server.project, "the saved version");
          lastSynced = useEditor.getState().project;
          writeLink({ id: get().cloudId!, version: server.version, userId: user.id, hash: hashProject(lastSynced) });
          set({ cloudVersion: server.version, sync: "synced", message: READ_ONLY_TEXT });
        } catch { set({ sync: "error", message: READ_ONLY_TEXT }); }
      } else if (e instanceof ConflictError) set({ sync: "conflict", message: null });
      else if (e instanceof NotFoundError) {
        get().unlink();
        set({ message: "This project was deleted or is no longer shared with you, so it's saved only on this device now." });
      } else set({ sync: "error", message: errText(e, "Couldn't reach the server. Your work is saved on this device and will sync when you're back online.") });
    } finally {
      running = false;
    }
  },

  resolveConflict: async (choice) => {
    const cloud = getCloud();
    const id = get().cloudId;
    const user = get().user;
    if (!cloud || !id || !user) return;
    try {
      const server = await cloud.loadProject(id);
      if (choice === "reload") {
        // Undoable: the user's own version stays one Undo away.
        useEditor.getState().loadProject(server.project, "reloading the server version");
        lastSynced = useEditor.getState().project;
        writeLink({ id, version: server.version, userId: user.id, hash: hashProject(lastSynced!) });
        set({ cloudVersion: server.version, sync: "synced", message: null });
      } else {
        // Keep mine: adopt the server's version number as the base, then save over it.
        set({ cloudVersion: server.version, sync: "idle", message: null });
        await get().pushSync();
      }
    } catch (e) {
      set({ message: errText(e, "Could not resolve the conflict. Please try again.") });
    }
  },

  unlink: () => {
    writeLink(null);
    lastSynced = null;
    applyRole("owner");
    set({ versions: [], cloudId: null, cloudVersion: 0, peopleCount: 0, sync: get().user ? "idle" : "off" });
    syncWatch();
  },
  clearMessage: () => set({ message: null }),
  clearNotice: () => set({ notice: null }),
  setPeopleCount: (n) => { set({ peopleCount: n }); syncWatch(); },

  leaveProject: async (id) => {
    try {
      await getCloud()!.leaveProject(id);
      if (get().cloudId === id) get().unlink();
      set({ shared: get().shared.filter((s) => s.id !== id) });
    } catch (e) {
      set({ message: errText(e, "Could not leave that project.") });
    }
  },

  checkRemote: async () => {
    const cloud = getCloud();
    const { user, cloudId, sync } = get();
    if (!cloud || !user || !cloudId || running || sync === "conflict" || sync === "syncing" || sync === "off") return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const remote = await cloud.projectVersion(cloudId);
      if (get().cloudId !== cloudId) return; // switched projects meanwhile
      if (remote === null) {
        get().unlink();
        set({ message: "You no longer have access to this project (it was deleted, or the owner stopped sharing it). It's saved only on this device now." });
        return;
      }
      // Every few checks, also ask whether my permission changed (view <-> edit), which doesn't change the version.
      if (get().role !== "owner" && ++watchTicks % 4 === 0) {
        const mine = (await cloud.listShared()).find((s) => s.id === cloudId)?.role;
        if (mine && mine !== get().role) {
          applyRole(mine);
          set({ notice: mine === "viewer" ? "The owner changed your access: you can now only view this project." : "The owner changed your access: you can now edit this project." });
        }
      }
      if (remote <= get().cloudVersion) return;
      if (useEditor.getState().project !== lastSynced) { void get().pushSync(); return; } // I have unsaved edits: this surfaces a conflict and lets me choose
      const server = await cloud.loadProject(cloudId);
      useEditor.getState().loadProject(server.project, "changes saved by someone else");
      useEditor.setState({ past: [], future: [] }); // never let Undo step back across someone else's changes
      lastSynced = useEditor.getState().project;
      writeLink({ id: cloudId, version: server.version, userId: user.id, hash: hashProject(lastSynced) });
      applyRole(server.role);
      set({ cloudVersion: server.version, sync: "synced", notice: "Updated with changes someone else saved." });
      void syncAssets(); // a teammate may have added pictures
    } catch { /* offline or a hiccup: the next check tries again */ }
  },
}));

export async function updateRemoteAssetAlt(id: string, alt: string): Promise<void> {
  const cloud = getCloud();
  if (!cloud || !useCloud.getState().user) return;
  try {
    await cloud.updateAssetAlt(id, alt);
  } catch {
    /* offline: the next sync pushes it */
  }
}

export async function deleteRemoteAsset(id: string): Promise<void> {
  const cloud = getCloud();
  if (!cloud || !useCloud.getState().user) return;
  try {
    await cloud.deleteAsset(id);
  } catch {
    /* offline: the local copy is still removed */
  }
}

/** Make the local media library and the cloud library match, in both directions. Best effort; never throws. */
export async function syncAssets(): Promise<void> {
  const cloud = getCloud();
  if (!cloud || !useCloud.getState().user) return;
  try {
    const remote = await cloud.listAssets();
    const local = await getAllAssets();
    const have = new Set(local.map((l) => l.asset.id));
    const haveRemote = new Set(remote.map((r) => r.id));
    const remoteById = new Map(remote.map((r) => [r.id, r]));

    // Descriptions (alt text): an empty side takes the other side's text; if both have text and they differ, this
    // device's text wins and is pushed (there are no timestamps, so "last device to sync" decides).
    for (const l of local) {
      const r = remoteById.get(l.asset.id);
      if (!r) continue;
      const mine = l.asset.alt ?? "";
      const theirs = r.alt ?? "";
      if (mine === theirs) continue;
      if (!mine && theirs) await useEditor.getState().setAssetAlt(l.asset.id, theirs);
      else await cloud.updateAssetAlt(l.asset.id, mine);
    }
    const hashes = new Set(local.map((l) => l.asset.hash));

    for (const a of remote) {
      if (have.has(a.id) || hashes.has(a.hash)) continue;
      const blob = await cloud.downloadAsset(a);
      await putAsset({ asset: a, blob });
    }
    for (const l of local) if (!haveRemote.has(l.asset.id)) await cloud.uploadAsset(l.asset, l.blob);
    await useEditor.getState().loadAssets();
  } catch {
    /* offline or partial failure: the next sync will retry */
  }
}
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as any).__cloud = useCloud;
