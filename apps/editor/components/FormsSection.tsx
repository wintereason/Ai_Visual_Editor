"use client";
import { SITE_SLUG, type SiteInfo, type Submission } from "@avc/cloud";
import { useCallback, useEffect, useState } from "react";
import { getCloud, useCloud } from "../lib/cloud";

export type FormsConnect = { supabaseUrl: string; anonKey: string; siteSlug: string };

/** The PUBLIC backend address and anon key, as configured for this app. Never a secret: both are already in every page we serve. */
export function formsBackend(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export const hasContactForm = (json: string) => json.includes('"type":"contactForm"');

const slugFrom = (name: string) => {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s.length >= 3 ? s : "";
};

const btn: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };
const input: React.CSSProperties = { flex: 1, padding: 6, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, minWidth: 0 };

function Inbox({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setRows((await getCloud()!.listSubmissions(projectId))); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load messages."); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  const remove = async (id: string) => {
    try { await getCloud()!.deleteSubmission(id); setRows((r) => (r ?? []).filter((x) => x.id !== id)); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete that message."); }
  };
  return (
    <div data-testid="inbox" style={{ marginTop: 8, border: "1px solid #e5e7eb", borderRadius: 6, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 13 }}>Messages from your site</b>
        <span style={{ display: "flex", gap: 6 }}><button style={btn} onClick={() => void load()}>Refresh</button><button style={btn} onClick={onClose}>Hide</button></span>
      </div>
      {error && <div role="alert" style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>{error}</div>}
      {rows && rows.length === 0 && !error && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>No messages yet.</div>}
      {rows?.map((r) => (
        <div key={r.id} data-testid="inbox-row" style={{ borderTop: "1px solid #f3f4f6", marginTop: 8, paddingTop: 8, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#6b7280", fontSize: 11 }}>
            <span>{new Date(r.createdAt).toLocaleString()}</span>
            <button style={{ ...btn, padding: "1px 8px" }} aria-label="Delete message" onClick={() => void remove(r.id)}>Delete</button>
          </div>
          {/* Visitor text is untrusted: React escapes it, and it is never treated as a link or markup. */}
          {Object.entries(r.fields).map(([k, v]) => <div key={k} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><b>{k}:</b> {v}</div>)}
        </div>
      ))}
    </div>
  );
}

/**
 * Contact-form delivery for the export dialog. Needs a signed-in user whose project is saved to the cloud, because messages
 * are filed under a site name and read back by the owner. Calls `onChange` with what to build into the site (or null).
 */
export function FormsSection({ projectName, onChange }: { projectName: string; onChange: (c: FormsConnect | null) => void }) {
  const { available, user, cloudId, role } = useCloud();
  const backend = formsBackend();
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [name, setName] = useState(slugFrom(projectName));
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [inbox, setInbox] = useState(false);
  const ready = available && !!user && !!cloudId && !!backend && role === "owner";

  useEffect(() => {
    if (!ready) return;
    let live = true;
    getCloud()!.getSite(cloudId!).then((s) => { if (live) { setSite(s); if (s) setName(s.slug); } }, () => {});
    return () => { live = false; };
  }, [ready, cloudId]);

  useEffect(() => {
    onChange(ready && site && on && backend ? { supabaseUrl: backend.url, anonKey: backend.key, siteSlug: site.slug } : null);
  }, [ready, site, on, backend?.url, backend?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = SITE_SLUG.test(name);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { const s = await getCloud()!.saveSite(cloudId!, name); setSite(s); setMsg({ ok: true, text: "Saved." }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save the site name." }); }
    finally { setBusy(false); }
  };

  let why: string | null = null;
  if (!available || !backend) why = "Contact forms need an account and a configured backend, which this copy doesn't have. The forms in an export will not deliver messages.";
  else if (!user) why = "Sign in (top right) to receive contact-form messages. Until then, forms in an export will not deliver them.";
  else if (role !== "owner") why = "Contact-form delivery is set up by this project's owner. Forms in an export will only deliver messages if the owner has connected them.";
  else if (!cloudId) why = "Your project isn't saved to your account yet. Open Projects and choose Save to cloud, then come back here to set a site name.";

  return (
    <div data-testid="forms-section" style={{ marginTop: 14, padding: 10, background: "#f9fafb", borderRadius: 6, fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Contact form delivery</div>
      {why ? <div style={{ color: "#92400e" }}>⚠ {why}</div> : (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <input aria-label="Site name" value={name} maxLength={40} onChange={(e) => { setName(e.target.value.toLowerCase()); setMsg(null); }} style={input} placeholder="my-school" />
            <button style={btn} disabled={!valid || busy || name === site?.slug} onClick={() => void save()}>{site ? "Rename" : "Create site"}</button>
          </div>
          {!valid && name !== "" && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 4 }}>Use 3 to 40 lowercase letters, numbers or hyphens.</div>}
          {msg && <div role={msg.ok ? "status" : "alert"} style={{ color: msg.ok ? "#15803d" : "#b91c1c", fontSize: 12, marginTop: 4 }}>{msg.text}</div>}
          {site && (
            <>
              <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Deliver form messages to my inbox
              </label>
              <div style={{ marginTop: 6 }}><button style={btn} onClick={() => setInbox((v) => !v)}>✉ {inbox ? "Hide messages" : "View messages"}</button></div>
              {inbox && <Inbox projectId={cloudId!} onClose={() => setInbox(false)} />}
            </>
          )}
          {!site && <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>Pick a name for your site. Messages from visitors are filed under it and shown here. Email notifications are not set up yet.</div>}
        </>
      )}
    </div>
  );
}
