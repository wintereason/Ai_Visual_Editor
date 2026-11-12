"use client";
import { useCallback, useEffect, useState } from "react";
import { MAX_PEOPLE, type Person, type ShareRole } from "@avc/cloud";
import { getCloud, useCloud } from "../lib/cloud";

const tb: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 13 };
const input: React.CSSProperties = { padding: "7px 8px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, boxSizing: "border-box" };
const ROLE_TEXT: Record<ShareRole, string> = { editor: "Can edit", viewer: "Can view" };

/** Owner only: invite people by email, change what they can do, and take access away. */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const cloudId = useCloud((s) => s.cloudId);
  const setPeopleCount = useCloud((s) => s.setPeopleCount);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cloud = getCloud();
    if (!cloud || !cloudId) return;
    try {
      const p = await cloud.listPeople(cloudId);
      setPeople(p);
      setPeopleCount(p.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load who has access.");
      setPeople([]);
    }
  }, [cloudId, setPeopleCount]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setError(null); setNote(null);
    try { await fn(); await load(); if (done) setNote(done); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); }
    finally { setBusy(false); }
  };

  const invite = () => run(async () => {
    await getCloud()!.shareProject(cloudId!, email, role);
    setEmail("");
  }, "Invitation sent. They get access the next time they sign in with that email.");

  const count = people?.length ?? 0;
  return (
    <div role="dialog" aria-label="Share project" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, width: 480, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>Share this project</h3>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p style={{ margin: "8px 0 12px", fontSize: 13, color: "#6b7280" }}>
          Invite people by email. <b>Editors</b> can change the project; <b>viewers</b> can only look. Only you can publish it, share it, or delete it.
        </p>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="email" aria-label="Email to invite" placeholder="name@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && !busy && void invite()}
            style={{ ...input, flex: 1 }}
          />
          <select aria-label="What they can do" value={role} onChange={(e) => setRole(e.target.value as ShareRole)} style={input}>
            <option value="editor">{ROLE_TEXT.editor}</option>
            <option value="viewer">{ROLE_TEXT.viewer}</option>
          </select>
          <button style={{ ...tb, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} disabled={busy || !email.trim() || count >= MAX_PEOPLE} onClick={() => void invite()}>Invite</button>
        </div>
        {error && <div role="alert" style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>{error}</div>}
        {note && <div role="status" data-testid="share-note" style={{ marginTop: 8, color: "#15803d", fontSize: 13 }}>{note}</div>}

        <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600 }}>People with access ({count} of {MAX_PEOPLE})</div>
        {people === null && <p style={{ fontSize: 13, color: "#6b7280" }}>Loading…</p>}
        {people?.length === 0 && <p style={{ fontSize: 13, color: "#6b7280" }}>Only you, for now.</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
          {people?.map((p) => (
            <li key={`${p.kind}:${p.email}`} data-testid={`person-${p.email}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #f3f4f6" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{p.email}</span>
                <span style={{ fontSize: 11, color: p.kind === "invited" ? "#b45309" : "#15803d" }}>{p.kind === "invited" ? "Invited: hasn't opened it yet" : "Has access"}</span>
              </span>
              <select
                aria-label={`Access for ${p.email}`} value={p.role} disabled={busy} style={{ ...input, padding: "4px 6px" }}
                onChange={(e) => void run(() => getCloud()!.shareProject(cloudId!, p.email, e.target.value as ShareRole), p.kind === "member" ? "Changed. It takes effect the next time they open the project." : undefined)}
              >
                <option value="editor">{ROLE_TEXT.editor}</option>
                <option value="viewer">{ROLE_TEXT.viewer}</option>
              </select>
              <button style={{ ...tb, color: "#b91c1c" }} disabled={busy} aria-label={`Remove ${p.email}`}
                onClick={() => void run(() => getCloud()!.unshare(cloudId!, p.kind === "member" ? { userId: p.userId } : { email: p.email }))}>Remove</button>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 11, color: "#6b7280", marginTop: 14 }}>
          Changes from other people appear in your editor within about 15 seconds. If you both change the same thing at the same time, you'll be asked which version to keep.
        </p>
      </div>
    </div>
  );
}
