"use client";
import { useRef, useState } from "react";
import { useCloud } from "../lib/cloud";
import { domainRequest, isAccountId, isProjectName, projectNameFrom, publishToCloudflare, type DomainOk, type PublishOk, type PublishProgress } from "../lib/publish";

const KEY = "avc:cloudflare:v1";   // not secret: account id, project name, last address
const TOKEN_KEY = "avc:cftoken";   // SECRET: sessionStorage only (gone when the tab closes), and only if the person ticks the box

const read = (): { accountId?: string; projectName?: string; lastUrl?: string } => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } };
const write = (v: object) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };

const btn: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: 6, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, marginTop: 2 };

const STAGE: Record<PublishProgress["stage"], string> = {
  project: "Setting up your Cloudflare project…", token: "Getting permission to upload…", uploading: "Uploading files…", deploying: "Publishing…", verifying: "Checking that your pages load…",
};

/**
 * Publish to the person's OWN Cloudflare Pages account. Their API token is typed here, sent once to our server over HTTPS in a
 * header, used for this publish and discarded. It is not saved anywhere unless they tick "remember until I close this tab".
 */
export function PublishSection({ projectName, blocked, build, baseUrl, onAddress }: {
  projectName: string; blocked: boolean; baseUrl: string; onAddress: (a: string) => void;
  build: (address?: string) => Promise<Record<string, Uint8Array> | null>;
}) {
  const { available, user } = useCloud();
  const saved = typeof window === "undefined" ? {} : read();
  const [accountId, setAccountId] = useState((saved.accountId ?? "").toLowerCase());
  const [name, setName] = useState(saved.projectName ?? projectNameFrom(projectName));
  const [token, setToken] = useState(typeof window === "undefined" ? "" : readToken());
  const [remember, setRemember] = useState(typeof window !== "undefined" && readToken() !== "");
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PublishOk | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const [domain, setDomain] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainErr, setDomainErr] = useState<string | null>(null);
  const [domainInfo, setDomainInfo] = useState<DomainOk | null>(null);

  const idOk = isAccountId(accountId.trim());
  const nameOk = isProjectName(name);
  const tokenOk = /^[A-Za-z0-9_-]{20,200}$/.test(token.trim());
  const can = available && !!user && idOk && nameOk && tokenOk && !blocked && !busy;

  const go = async () => {
    if (!can) return;
    setBusy(true); setError(null); setDone(null); setProgress(null);
    ctl.current = new AbortController();
    try {
      const files = await build(baseUrl.trim());
      if (!files) { setError("The site couldn't be built. See the problems listed below."); return; }
      const r = await publishToCloudflare({ files, accountId: accountId.trim(), token: token.trim(), projectName: name }, setProgress, ctl.current.signal);
      if (!r.ok) { if (r.code !== "cancelled") setError(r.message); return; }
      setDone(r);
      write({ accountId: accountId.trim(), projectName: name, lastUrl: r.productionUrl });
      try { remember ? sessionStorage.setItem(TOKEN_KEY, token.trim()) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
      if (!remember) setToken(""); // a token that isn't remembered is cleared from the screen as soon as it has been used
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const canDomain = available && !!user && idOk && nameOk && tokenOk && domain.trim() !== "" && !domainBusy;
  const connect = async (action: "connect" | "status") => {
    if (!canDomain) return;
    setDomainBusy(true); setDomainErr(null);
    const r = await domainRequest(action, { accountId: accountId.trim(), token: token.trim(), projectName: name, domain: domain.trim() });
    setDomainBusy(false);
    if (!r.ok) { setDomainErr(r.message); return; }
    setDomainInfo(r);
    setDomain(r.domain);
  };

  let why: string | null = null;
  if (!available) why = "Publishing needs an account, and this copy has no backend configured. Download the .zip instead.";
  else if (!user) why = "Sign in (top right) to publish. This keeps strangers from using the publishing service. Or download the .zip.";

  return (
    <div data-testid="publish-section" style={{ marginTop: 14, padding: 10, background: "#f9fafb", borderRadius: 6, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>Publish to Cloudflare</b>
        <button style={btn} aria-expanded={help} onClick={() => setHelp((v) => !v)}>{help ? "Hide steps" : "How do I set this up?"}</button>
      </div>
      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>Puts your site online for free in your own Cloudflare account, at a <b>.pages.dev</b> address.</div>

      {help && (
        <ol data-testid="publish-help" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
          <li>Create a free account at <b>dash.cloudflare.com/sign-up</b>.</li>
          <li><b>Account ID:</b> in the dashboard open <b>Workers &amp; Pages</b>; the Account ID is shown on the right (it's also in the address bar after <code>dash.cloudflare.com/</code>).</li>
          <li><b>API token:</b> go to <b>My Profile → API Tokens → Create Token → Create Custom Token</b>. Permission: <b>Account → Cloudflare Pages → Edit</b>. Account Resources: your account. Create it and copy the token (it is shown only once).</li>
          <li>Paste both below. Cloudflare may rename menus; if one is missing, search the dashboard for "API tokens".</li>
        </ol>
      )}

      {why ? <div style={{ color: "#92400e", marginTop: 8 }}>⚠ {why}</div> : (
        <>
          <label style={{ display: "block", marginTop: 8 }}>Account ID
            <input aria-label="Cloudflare account ID" value={accountId} maxLength={40} autoComplete="off" spellCheck={false} onChange={(e) => setAccountId(e.target.value.trim().toLowerCase())} style={input} placeholder="32 letters and numbers" />
          </label>
          {accountId && !idOk && <div style={{ color: "#b91c1c", fontSize: 12 }}>An account ID is exactly 32 letters (a–f) and numbers.</div>}
          <label style={{ display: "block", marginTop: 8 }}>API token
            <input aria-label="Cloudflare API token" type="password" value={token} maxLength={220} autoComplete="off" spellCheck={false} onChange={(e) => setToken(e.target.value)} style={input} placeholder="Paste your token" />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, fontSize: 12, color: "#4b5563" }}>
            <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); if (!e.target.checked) { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* */ } } }} /> Remember the token until I close this tab
          </label>
          <label style={{ display: "block", marginTop: 8 }}>Project name <span style={{ color: "#6b7280" }}>(becomes <b>{nameOk ? name : "name"}.pages.dev</b>, if available)</span>
            <input aria-label="Cloudflare project name" value={name} maxLength={58} onChange={(e) => setName(e.target.value.toLowerCase())} style={input} />
          </label>
          {name && !nameOk && <div style={{ color: "#b91c1c", fontSize: 12 }}>Use lowercase letters, numbers and hyphens, not starting or ending with a hyphen.</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={{ ...btn, background: can ? "#2563eb" : "#e5e7eb", color: can ? "#fff" : "#6b7280", borderColor: can ? "#2563eb" : "#d1d5db", flex: 1, padding: "6px 10px" }} disabled={!can} title={blocked ? "Fix errors first" : ""} onClick={() => void go()}>
              {busy ? (progress ? (progress.stage === "uploading" && progress.total ? `Uploading files ${progress.done}/${progress.total}…` : STAGE[progress.stage]) : "Building…") : "🚀 Publish"}
            </button>
            {busy && <button style={btn} onClick={() => ctl.current?.abort()}>Cancel</button>}
          </div>
        </>
      )}

      {!why && (
        <div data-testid="domain-section" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e5e7eb" }}>
          <b>Your own domain</b> <span style={{ color: "#6b7280", fontSize: 12 }}>(optional, after you have published)</span>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input aria-label="Custom domain" value={domain} maxLength={253} autoComplete="off" spellCheck={false} placeholder="www.yourschool.com" onChange={(e) => { setDomain(e.target.value.trim().toLowerCase()); setDomainInfo(null); setDomainErr(null); }} style={{ ...input, marginTop: 0, flex: 1 }} />
            <button style={btn} disabled={!canDomain} title={tokenOk ? "" : "Paste your API token above first"} onClick={() => void connect("connect")}>{domainBusy ? "Working…" : "Connect"}</button>
          </div>
          {!tokenOk && domain && <div style={{ color: "#92400e", fontSize: 12, marginTop: 4 }}>Paste your API token above to connect a domain.</div>}
          {domainErr && <div role="alert" data-testid="domain-error" style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>⚠ {domainErr}</div>}
          {domainInfo && (
            <div role="status" data-testid="domain-info" style={{ marginTop: 8, padding: 8, borderRadius: 6, fontSize: 12, background: domainInfo.active ? "#f0fdf4" : "#fffbeb" }}>
              {domainInfo.active ? (
                <><b>✔ {domainInfo.domain} is connected.</b> Visit <a href={"https://" + domainInfo.domain} target="_blank" rel="noopener noreferrer">https://{domainInfo.domain}</a>.</>
              ) : (
                <>
                  <b>Almost there: {domainInfo.domain} is waiting for DNS.</b> Status: {domainInfo.status}.
                  {domainInfo.isApex ? (
                    <p style={{ margin: "6px 0 0" }}>A bare domain like <b>{domainInfo.domain}</b> must use Cloudflare for its DNS, in the same account as this project. Add the domain to Cloudflare, change its nameservers where you bought it, and Cloudflare completes the rest. (Prefer <b>www.{domainInfo.domain}</b>? That can stay with your current DNS provider.)</p>
                  ) : (
                    <p style={{ margin: "6px 0 0" }}>At your domain&apos;s DNS provider, add a record: <b>CNAME</b> named <b>{domainInfo.domain}</b> pointing to <b data-testid="cname-target">{domainInfo.cnameTarget}</b>. If the domain is already on Cloudflare this is done for you.</p>
                  )}
                  {domainInfo.detail && <p style={{ margin: "4px 0 0", color: "#6b7280" }}>Cloudflare says: {domainInfo.detail}</p>}
                  <button style={{ ...btn, marginTop: 6 }} disabled={!canDomain} onClick={() => void connect("status")}>Check again</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div role="alert" data-testid="publish-error" style={{ marginTop: 8, color: "#b91c1c", fontSize: 12 }}>⚠ {error}</div>}

      {done && (
        <div role="status" data-testid="publish-done" style={{ marginTop: 8, padding: 8, borderRadius: 6, background: done.verified ? "#f0fdf4" : "#fffbeb", fontSize: 12 }}>
          {done.verified ? <b>✔ Your site is live.</b> : <b>⚠ Published, but the pages didn't load yet.</b>}
          <div style={{ marginTop: 4 }}>
            Address: <a href={done.productionUrl} target="_blank" rel="noopener noreferrer" data-testid="publish-url">{done.productionUrl}</a>
          </div>
          {done.verified
            ? <div style={{ color: "#4b5563", marginTop: 2 }}>{done.files} files ({done.uploaded} new) checked and loading.</div>
            : <div style={{ marginTop: 2 }}>It can take a minute to appear. If it still shows "not found", download the .zip and upload it by hand in Cloudflare (Workers &amp; Pages → Create → Pages → Upload assets), and tell us.</div>}
          {!baseUrl.trim() && done.verified && (
            <div style={{ marginTop: 4 }}>Search engines work best when the site knows its address. <button style={btn} onClick={() => onAddress(done.productionUrl)}>Use it as my site address</button> then publish again.</div>
          )}
        </div>
      )}
    </div>
  );
}
