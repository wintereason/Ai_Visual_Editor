"use client";
import { useEffect, useState } from "react";

const KEY = "avc:analytics:v1"; // not secret: a Cloudflare Web Analytics site token is public (it is in every page's source)
const read = (): { on?: boolean; token?: string } => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } };
const TOKEN = /^[a-f0-9]{32}$/;

/** Opt-in visit counting with Cloudflare Web Analytics (no cookies, no profiles). Reports the token to use, or null when off/invalid. */
export function AnalyticsSection({ onChange }: { onChange: (token: string | null) => void }) {
  const saved = typeof window === "undefined" ? {} : read();
  const [on, setOn] = useState(!!saved.on);
  const [token, setToken] = useState(saved.token ?? "");
  const [help, setHelp] = useState(false);
  const valid = TOKEN.test(token.trim());

  useEffect(() => {
    onChange(on && valid ? token.trim() : null);
    try { localStorage.setItem(KEY, JSON.stringify({ on, token: token.trim() })); } catch { /* storage unavailable */ }
  }, [on, token, valid]); // eslint-disable-line react-hooks/exhaustive-deps

  const btn: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };
  return (
    <div data-testid="analytics-section" style={{ marginTop: 14, padding: 10, background: "#f9fafb", borderRadius: 6, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600 }}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Count visits (Cloudflare Web Analytics)
        </label>
        <button style={btn} aria-expanded={help} onClick={() => setHelp((v) => !v)}>{help ? "Hide steps" : "How?"}</button>
      </div>
      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>Free and cookie-less. Shows page views and countries in your Cloudflare dashboard. Mention it in your privacy page.</div>
      {help && (
        <ol data-testid="analytics-help" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
          <li>In the Cloudflare dashboard open <b>Analytics &amp; Logs → Web Analytics</b> and choose <b>Add a site</b>.</li>
          <li>Enter your site&apos;s address (for example <code>my-site.pages.dev</code>) and continue.</li>
          <li>In the snippet shown, copy the 32-character value after <code>&quot;token&quot;:</code>.</li>
        </ol>
      )}
      {on && (
        <>
          <input aria-label="Analytics token" value={token} maxLength={40} autoComplete="off" spellCheck={false} placeholder="32 letters and numbers" onChange={(e) => setToken(e.target.value.trim().toLowerCase())}
            style={{ width: "100%", boxSizing: "border-box", marginTop: 8, padding: 6, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }} />
          {token && !valid && <div role="alert" style={{ color: "#b91c1c", fontSize: 12, marginTop: 4 }}>A token is exactly 32 letters (a–f) and numbers.</div>}
          {!token && <div style={{ color: "#92400e", fontSize: 12, marginTop: 4 }}>Paste your token to turn counting on.</div>}
        </>
      )}
    </div>
  );
}
