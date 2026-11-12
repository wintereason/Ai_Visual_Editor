"use client";
import { useEffect, useState } from "react";
import type { Usage } from "@avc/cloud";
import { buildAccountExport } from "../lib/accountExport";
import { getCloud, useCloud } from "../lib/cloud";
import { CreditsDialog } from "./CreditsDialog";
import { ShareDialog } from "./ShareDialog";

const tb: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 };
const panel: React.CSSProperties = { background: "#fff", borderRadius: 8, padding: 20, width: 440, maxHeight: "80vh", overflow: "auto" };

const SYNC_TEXT = { off: "", idle: "☁ Not synced", syncing: "☁ Syncing…", synced: "☁ Synced ✓", conflict: "☁ Conflict", error: "☁ Offline" } as const;

function SignInDialog({ onClose }: { onClose: () => void }) {
  const { signIn } = useCloud();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const user = useCloud((s) => s.user);

  // A magic link signs the user in in another tab/window; close once the session appears.
  useEffect(() => { if (user) onClose(); }, [user, onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Sign in" style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px" }}>Sign in</h3>
        {sent ? (
          <p style={{ fontSize: 14 }}>
            Check your email for a sign-in link. You can close this window; the link will sign you in.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>We'll email you a link. No password needed. Signing in keeps your projects and images in the cloud.</p>
            <input
              type="email" autoFocus aria-label="Email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && void submit()}
              style={{ width: "100%", padding: 8, boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 4 }}
            />
            {error && <div role="alert" style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}
          </>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button style={tb} onClick={onClose}>{sent ? "Close" : "Cancel"}</button>
          {!sent && <button style={{ ...tb, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} disabled={busy || !email} onClick={() => void submit()}>{busy ? "Sending…" : "Send link"}</button>}
        </div>
      </div>
    </div>
  );
}

const mb = (b: number) => (b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0);

function Meter({ label, used, limit, text }: { label: string; used: number; limit: number; text: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div style={{ fontSize: 12, marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>{label}</span><span data-testid={`usage-${label.toLowerCase()}`}>{text}</span></div>
      <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, background: "#e5e7eb", borderRadius: 3, marginTop: 2 }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 3, background: pct >= 90 ? "#dc2626" : "#2563eb" }} />
      </div>
    </div>
  );
}

/** Usage against limits, a full data download, and permanent account deletion. */
function AccountSection({ onClose }: { onClose: () => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const projectCount = useCloud((s) => s.projects.length);

  useEffect(() => { let live = true; getCloud()?.getUsage().then((u) => live && setUsage(u), () => {}); return () => { live = false; }; }, [projectCount]);

  const download = async () => {
    setBusy("export"); setNote(null);
    try {
      const r = await buildAccountExport(getCloud()!);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: "application/zip" }));
      a.download = "my-data.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setNote({ ok: !r.problems.length, text: `Downloaded ${r.projects} project(s), ${r.media} file(s), ${r.messages} message(s).${r.problems.length ? ` ${r.problems.length} item(s) couldn't be included; see README.txt in the zip.` : ""}` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't build the download." });
    } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete"); setNote(null);
    try {
      await getCloud()!.deleteAccount();
      useCloud.getState().unlink();
      onClose();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't delete the account." });
      setBusy(null);
    }
  };

  return (
    <div data-testid="account-section" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <b style={{ fontSize: 13 }}>Your account</b>
      {usage && (
        <>
          <Meter label="Projects" used={usage.projects} limit={usage.projectsLimit} text={`${usage.projects} of ${usage.projectsLimit}`} />
          <Meter label="Storage" used={usage.storageBytes} limit={usage.storageLimit} text={`${mb(usage.storageBytes)} MB of ${mb(usage.storageLimit)} MB`} />
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button style={tb} disabled={busy !== null} onClick={() => void download()}>{busy === "export" ? "Preparing…" : "⬇ Download all my data"}</button>
        {!confirming && <button style={{ ...tb, color: "#b91c1c" }} disabled={busy !== null} onClick={() => setConfirming(true)}>Delete my account…</button>}
      </div>
      {confirming && (
        <div role="group" aria-label="Confirm account deletion" style={{ marginTop: 10, padding: 10, background: "#fef2f2", borderRadius: 6, fontSize: 13 }}>
          <b>This permanently deletes your account, all cloud projects, images, published-site records and messages.</b> It can't be undone. The project open in this browser stays here on this device. Download your data first if you want a copy.
          <input aria-label="Type DELETE to confirm" placeholder="Type DELETE" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, padding: 6, border: "1px solid #fca5a5", borderRadius: 4 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={tb} onClick={() => { setConfirming(false); setTyped(""); }}>Cancel</button>
            <button style={{ ...tb, background: typed === "DELETE" ? "#b91c1c" : "#e5e7eb", color: typed === "DELETE" ? "#fff" : "#6b7280" }} disabled={typed !== "DELETE" || busy !== null} onClick={() => void remove()}>{busy === "delete" ? "Deleting…" : "Permanently delete"}</button>
          </div>
        </div>
      )}
      {note && <div role={note.ok ? "status" : "alert"} style={{ marginTop: 8, fontSize: 12, color: note.ok ? "#15803d" : "#b91c1c" }}>{note.text}</div>}
    </div>
  );
}

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const { projects, shared, projectsLoading, cloudId, refreshProjects, openProject, deleteProject, leaveProject, saveToCloud, message, sync } = useCloud();
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  const open = async (id: string) => { await openProject(id); if (!useCloud.getState().message) onClose(); };

  return (
    <div role="dialog" aria-label="Your projects" style={overlay} onClick={onClose}>
      <div style={{ ...panel, width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>Your projects</h3>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {!cloudId && (
          <div style={{ margin: "12px 0", padding: 10, background: "#eff6ff", borderRadius: 6, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }}>The project you're editing is only on this device.</span>
            <button style={{ ...tb, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} disabled={sync === "syncing"} onClick={() => void saveToCloud().then(refreshProjects)}>Save to cloud</button>
          </div>
        )}
        {message && <div role="alert" style={{ margin: "8px 0", color: "#b91c1c", fontSize: 13 }}>{message}</div>}
        {projectsLoading && <p style={{ color: "#6b7280", fontSize: 13 }}>Loading…</p>}
        {!projectsLoading && projects.length === 0 && <p style={{ color: "#6b7280", fontSize: 13 }}>No cloud projects yet.</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {projects.map((p) => (
            <li key={p.id} data-testid={`cloud-project-${p.name}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #f3f4f6" }}>
              <span style={{ flex: 1 }}>
                <b>{p.name}</b> {p.id === cloudId && <span style={{ fontSize: 11, color: "#2563eb" }}>· open now</span>}
                <br />
                <span style={{ fontSize: 11, color: "#6b7280" }}>Updated {new Date(p.updatedAt).toLocaleString()} · v{p.version}</span>
              </span>
              <button style={tb} disabled={p.id === cloudId} onClick={() => void open(p.id)}>Open</button>
              <button style={{ ...tb, color: "#b91c1c" }} onClick={() => confirm(`Delete "${p.name}" from the cloud? This can't be undone.`) && void deleteProject(p.id)}>Delete</button>
            </li>
          ))}
        </ul>
        {shared.length > 0 && (
          <div data-testid="shared-with-me" style={{ marginTop: 16 }}>
            <b style={{ fontSize: 13 }}>Shared with you</b>
            <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
              {shared.map((p) => (
                <li key={p.id} data-testid={`shared-project-${p.name}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #f3f4f6" }}>
                  <span style={{ flex: 1 }}>
                    <b>{p.name}</b> {p.id === cloudId && <span style={{ fontSize: 11, color: "#2563eb" }}>· open now</span>}
                    <br />
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{p.role === "editor" ? "You can edit" : "View only"} · from {p.ownerEmail || "another person"}</span>
                  </span>
                  <button style={tb} disabled={p.id === cloudId} onClick={() => void open(p.id)}>Open</button>
                  <button style={tb} onClick={() => confirm(`Stop having access to "${p.name}"? The owner can invite you again.`) && void leaveProject(p.id)}>Leave</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <AccountSection onClose={onClose} />
      </div>
    </div>
  );
}

/** Header controls. Renders nothing when no backend is configured, so local-only use is unchanged. */
export function CloudControls() {
  const { available, user, sync, signOut, cloudId, role, shared } = useCloud();
  const [dialog, setDialog] = useState<"signin" | "projects" | "credits" | "share" | null>(null);
  const owner = shared.find((s) => s.id === cloudId)?.ownerEmail;
  if (!available) return null;

  return (
    <>
      {user && <span data-testid="sync-status" title={user.email} style={{ fontSize: 12, color: sync === "error" || sync === "conflict" ? "#b91c1c" : "#6b7280" }}>{SYNC_TEXT[sync]}</span>}
      {user ? (
        <>
          {cloudId && role === "owner" && <button style={tb} onClick={() => setDialog("share")}>Share</button>}
          {cloudId && role !== "owner" && (
            <span data-testid="role-badge" title={owner ? `Shared by ${owner}` : "Shared with you"} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: role === "viewer" ? "#fef3c7" : "#dbeafe", color: role === "viewer" ? "#92400e" : "#1e40af" }}>
              {role === "viewer" ? "👁 View only" : "✎ Shared: you can edit"}
            </span>
          )}
          <button style={tb} onClick={() => setDialog("projects")}>Projects</button>
          <button style={tb} onClick={() => setDialog("credits")}>✦ Credits</button>
          <button style={tb} title={user.email} onClick={() => void signOut()}>Sign out</button>
        </>
      ) : (
        <button style={tb} onClick={() => setDialog("signin")}>Sign in</button>
      )}
      {dialog === "signin" && <SignInDialog onClose={() => setDialog(null)} />}
      {dialog === "projects" && <ProjectsDialog onClose={() => setDialog(null)} />}
      {dialog === "credits" && <CreditsDialog onClose={() => setDialog(null)} />}
      {dialog === "share" && <ShareDialog onClose={() => setDialog(null)} />}
    </>
  );
}

/** Shown when the server has a newer version than this editor's base. Nothing is overwritten until the user chooses. */
export function CloudBanner() {
  const { sync, message, resolveConflict, clearMessage, pushSync, notice, clearNotice } = useCloud();
  if (sync === "conflict") {
    return (
      <div role="alert" data-testid="conflict-banner" style={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 90, background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 8, padding: "10px 14px", fontSize: 13, maxWidth: 560, boxShadow: "0 4px 16px rgba(0,0,0,.15)" }}>
        <b>This project was changed somewhere else</b> (another tab, device, or person you share it with). Your edits are safe on this device. Choose what to keep:
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button style={tb} onClick={() => void resolveConflict("reload")}>Load their version (you can undo)</button>
          <button style={{ ...tb, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} onClick={() => void resolveConflict("overwrite")}>Keep mine and overwrite</button>
        </div>
      </div>
    );
  }
  if (notice && !message) {
    return (
      <div role="status" data-testid="cloud-notice" style={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 90, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 12px", fontSize: 13, maxWidth: 560 }}>
        {notice}
        <button aria-label="Dismiss" style={{ marginLeft: 8 }} onClick={clearNotice}>✕</button>
      </div>
    );
  }
  if (message && sync !== "off") {
    return (
      <div role="status" data-testid="cloud-message" style={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 90, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 13, maxWidth: 560 }}>
        {message}
        {sync === "error" && <button style={{ ...tb, marginLeft: 8 }} onClick={() => void pushSync()}>Retry</button>}
        <button aria-label="Dismiss" style={{ marginLeft: 8 }} onClick={clearMessage}>✕</button>
      </div>
    );
  }
  return null;
}
