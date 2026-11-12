import { create } from "zustand";
import { applyPatch, exampleProject, type Breakpoint, type Node, type Patch, type Project, planKeyboardMove, type MoveDir } from "@avc/schema";
import { addVersion, loadProject, loadVersions, saveProject, type Version } from "./persist";
import { collectAssetIds, type Asset } from "@avc/schema";
import { deleteAsset, deriveImage, getAsset, getAllAssets, processUpload, putAsset, UploadError, type TransformOp } from "./assets";

let counter = 0;
export const newId = (prefix = "n") => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

type State = {
  project: Project;
  pageId: string;
  past: Project[];
  future: Project[];
  selection: string | null;
  device: Breakpoint;
  error: string | null;
  /** True when the open project was shared with me as view-only: every change is refused. */
  readOnly: boolean;
  /** The latest thing a screen reader should be told (a move, a selection, why something was refused). */
  announcement: string;
  commit: (patch: Patch, opts?: { scope?: string; select?: string | null }) => boolean;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  setPage: (id: string) => void;
  setDevice: (d: Breakpoint) => void;
  clearError: () => void;
  hydrated: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  versions: Version[];
  hydrate: () => void;
  saveNow: () => void;
  saveVersion: (label: string) => void;
  restoreVersion: (id: string) => void;
  loadProject: (project: Project, label: string) => void;
  assets: Asset[];
  assetUrls: Record<string, string>;
  uploadErrors: string[];
  uploading: boolean;
  loadAssets: () => Promise<void>;
  addFiles: (files: File[]) => Promise<Asset[]>;
  removeAsset: (id: string) => Promise<void>;
  /** Create a rotated / cropped copy in the library (original untouched). Resolves to the new (or already existing) asset. */
  deriveAsset: (sourceId: string, op: TransformOp) => Promise<Asset>;
  setAssetAlt: (id: string, alt: string) => Promise<void>;
  clearUploadErrors: () => void;
};

const MAX_HISTORY = 100;

export const useEditor = create<State>((set, get) => ({
  project: exampleProject,
  pageId: exampleProject.pages[0]!.id,
  past: [],
  future: [],
  selection: null,
  device: "base",
  error: null,
  readOnly: false,
  announcement: "",

  // The only write path (spec 4.2, 5): every change, manual or AI, is a patch.
  commit: (patch, opts) => {
    if (get().readOnly) {
      set({ error: "This project is view-only, so it can't be changed." });
      return false;
    }
    const { project, past } = get();
    const r = applyPatch(project, patch, { scope: opts?.scope });
    if (!r.ok) {
      set({ error: r.errors[0] ?? "Patch rejected" });
      return false;
    }
    set({
      project: r.project,
      pageId: validPage(r.project, get().pageId),
      past: [...past, project].slice(-MAX_HISTORY),
      future: [],
      error: null,
      ...(opts?.select !== undefined ? { selection: opts.select } : {}),
    });
    return true;
  },
  undo: () => {
    if (get().readOnly) return;
    const { past, future, project } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ project: prev, pageId: validPage(prev, get().pageId), past: past.slice(0, -1), future: [project, ...future], error: null });
  },
  redo: () => {
    if (get().readOnly) return;
    const { past, future, project } = get();
    const next = future[0];
    if (!next) return;
    set({ project: next, pageId: validPage(next, get().pageId), past: [...past, project], future: future.slice(1), error: null });
  },
  select: (id) => set({ selection: id }),
  setPage: (id) => set((s) => (s.project.pages.some((p) => p.id === id) ? { pageId: id, selection: null } : {})),
  setDevice: (device) => set({ device }),
  clearError: () => set({ error: null }),
  hydrated: false,
  saveStatus: "idle",
  versions: [],
  hydrate: () => {
    const saved = loadProject();
    set({ ...(saved ? { project: saved, pageId: saved.pages[0]!.id } : {}), versions: loadVersions(), hydrated: true });
    void get().loadAssets();
  },
  saveNow: () => set({ saveStatus: saveProject(get().project) ? "saved" : "error" }),
  saveVersion: (label) => set({ versions: addVersion(get().versions, get().project, label) }),
  assets: [],
  assetUrls: {},
  uploadErrors: [],
  uploading: false,
  clearUploadErrors: () => set({ uploadErrors: [] }),
  loadAssets: async () => {
    try {
      const all = await getAllAssets();
      const urls: Record<string, string> = {};
      for (const old of Object.values(get().assetUrls)) URL.revokeObjectURL(old);
      for (const { asset, blob } of all) urls[asset.id] = URL.createObjectURL(blob);
      set({ assets: all.map((a) => a.asset).sort((a, b) => b.createdAt - a.createdAt), assetUrls: urls });
    } catch {
      set({ uploadErrors: ["Media storage is unavailable in this browser; uploads will not be kept."] });
    }
  },
  addFiles: async (files) => {
    set({ uploading: true, uploadErrors: [] });
    const added: Asset[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const stored = await processUpload(file);
        const dup = get().assets.find((a) => a.hash === stored.asset.hash);
        if (dup) { added.push(dup); continue; } // same bytes already uploaded: reuse
        await putAsset(stored);
        const url = URL.createObjectURL(stored.blob);
        set((s) => ({ assets: [stored.asset, ...s.assets], assetUrls: { ...s.assetUrls, [stored.asset.id]: url } }));
        added.push(stored.asset);
      } catch (e) {
        errors.push(e instanceof UploadError ? e.message : `${file.name}: upload failed`);
      }
    }
    set({ uploading: false, uploadErrors: errors });
    return added;
  },
  deriveAsset: async (sourceId, op) => {
    const source = await getAsset(sourceId);
    if (!source) throw new UploadError("The original file is no longer in your library.");
    const derived = await deriveImage(source, op);
    const dup = get().assets.find((a) => a.hash === derived.asset.hash);
    if (dup) return dup; // identical result already exists: reuse it
    await putAsset(derived);
    const url = URL.createObjectURL(derived.blob);
    set((st) => ({ assets: [derived.asset, ...st.assets], assetUrls: { ...st.assetUrls, [derived.asset.id]: url } }));
    return derived.asset;
  },
  removeAsset: async (id) => {
    await deleteAsset(id);
    const url = get().assetUrls[id];
    if (url) URL.revokeObjectURL(url);
    set((s) => { const { [id]: _gone, ...rest } = s.assetUrls; return { assets: s.assets.filter((a) => a.id !== id), assetUrls: rest }; });
  },
  setAssetAlt: async (id, alt) => {
    const cur = get().assets.find((a) => a.id === id);
    if (!cur) return;
    const asset = { ...cur, alt };
    const all = await getAllAssets();
    const blob = all.find((x) => x.asset.id === id)?.blob;
    if (blob) await putAsset({ asset, blob });
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? asset : a)) }));
  },
  loadProject: (next, label) => {
    const { project, past } = get();
    // Replacing the project is undoable and snapshotted, so starting from a template never destroys work.
    set({ versions: addVersion(get().versions, project, `Before ${label}`), project: next, pageId: next.pages[0]!.id, past: [...past, project].slice(-MAX_HISTORY), future: [], selection: null, error: null });
  },
  restoreVersion: (id) => {
    const v = get().versions.find((x) => x.id === id);
    if (!v) return;
    const { project, past } = get();
    // Restore is itself an undoable change; nothing is lost (spec W23).
    set({ versions: addVersion(get().versions, project, "Before restore"), project: v.project, pageId: v.project.pages[0]!.id, past: [...past, project].slice(-MAX_HISTORY), future: [], selection: null, error: null });
  },
}));

/** Tell screen-reader users what just happened. The zero-width space makes a repeated message still count as a change. */
export const announce = (message: string) => useEditor.setState((s) => ({ announcement: s.announcement === message ? message + "\u200b" : message }));

/** Reorder / nest / un-nest an item, deciding with the same rules as a mouse drag, and tell screen-reader users the outcome. */
export function keyboardMove(id: string, dir: MoveDir): boolean {
  const st = useEditor.getState();
  const plan = planKeyboardMove(st.project, st.pageId, id, dir);
  if (!plan.ok) { announce(plan.reason); return false; }
  // A moved row can be re-created in its new place in the Layers list, which would drop the keyboard focus. Put it back.
  const hadFocus = typeof document !== "undefined" && !!(document.activeElement as HTMLElement | null)?.closest?.('[role="tree"]');
  if (!st.commit({ summary: plan.summary, ops: [{ op: "move", id, parentId: plan.parentId, index: plan.index }] })) { announce("That move isn't allowed."); return false; }
  announce(plan.announce);
  if (hadFocus) requestAnimationFrame(() => (document.querySelector(`[role="treeitem"][data-layer-id="${id}"]`) as HTMLElement | null)?.focus());
  return true;
}

export function findNode(project: Project, id: string): { node: Node; parentId: string; index: number } | null {
  const visit = (nodes: Node[], parentId: string): ReturnType<typeof findNode> => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.id === id) return { node: n, parentId, index: i };
      const r = n.children && visit(n.children, n.id);
      if (r) return r;
    }
    return null;
  };
  for (const p of project.pages) {
    const r = visit(p.nodes, p.id);
    if (r) return r;
  }
  return null;
}

export function cloneWithNewIds(n: Node): Node {
  return { ...structuredClone(n), id: newId(), children: n.children?.map(cloneWithNewIds) };
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as any).__editor = useEditor;

/** Keep the current page valid after anything that can remove pages (delete, undo, restore). */
function validPage(project: Project, pageId: string): string {
  return project.pages.some((p) => p.id === pageId) ? pageId : project.pages[0]!.id;
}
export const usedAssetIds = (p: Project) => collectAssetIds(p);
