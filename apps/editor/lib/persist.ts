import { validateProject, type Project } from "@avc/schema";

const PROJECT_KEY = "avc:project:v1";
const VERSIONS_KEY = "avc:versions:v1";
const MAX_VERSIONS = 20;

export type Version = { id: string; at: number; label: string; project: Project };

// localStorage can be unavailable or throw (private mode, quota); never let that break the editor.
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Loaded data is untrusted: only accept it if it passes full registry validation. */
export function loadProject(): Project | null {
  const v = validateProject(read(PROJECT_KEY));
  return v.ok ? v.project : null;
}
export const saveProject = (p: Project) => write(PROJECT_KEY, p);

export function loadVersions(): Version[] {
  const raw = read(VERSIONS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => v && typeof v.id === "string" && typeof v.at === "number" && validateProject(v.project).ok)
    .slice(0, MAX_VERSIONS);
}

/** Newest first. Returns the new list (persisted best-effort). */
export function addVersion(list: Version[], project: Project, label: string): Version[] {
  const next = [{ id: `v_${Date.now().toString(36)}`, at: Date.now(), label, project }, ...list].slice(0, MAX_VERSIONS);
  write(VERSIONS_KEY, next);
  return next;
}

export function clearStorage() {
  try {
    localStorage.removeItem(PROJECT_KEY);
    localStorage.removeItem(VERSIONS_KEY);
  } catch {
    /* ignore */
  }
}

export function downloadJson(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "project"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
