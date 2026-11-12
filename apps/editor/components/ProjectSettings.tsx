"use client";
import { useEffect, useState } from "react";
import type { AppSettings, Project } from "@avc/schema";
import { previewAppIcon, iconBackground } from "../lib/appIcon";
import { useEditor } from "../lib/store";

const PLATFORMS: { id: Project["platform"]; title: string; text: string }[] = [
  { id: "web", title: "Website", text: "A normal website for computers, tablets and phones." },
  { id: "mobile", title: "Mobile app", text: "A phone-sized app with a tab bar that people can install." },
  { id: "web+mobile", title: "Website + app", text: "A responsive website that can also be installed like an app." },
];
const field: React.CSSProperties = { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, boxSizing: "border-box" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", margin: "12px 0 4px" };

/** Project type, and (for apps) the settings that make it installable. */
export function ProjectSettings({ onClose }: { onClose: () => void }) {
  const { project, commit, assets, setDevice } = useEditor();
  const [icon, setIcon] = useState<string | null>(null);
  const isApp = project.platform !== "web";
  const app = project.app ?? {};

  const setApp = (summary: string, patch: Partial<Record<keyof AppSettings, unknown>>) => commit({ summary, ops: [{ op: "setApp", app: patch }] as never });
  const setPlatform = (platform: Project["platform"]) => {
    if (platform === project.platform) return;
    if (commit({ summary: `Project type: ${platform}`, ops: [{ op: "setPlatform", platform }] })) {
      if (platform === "mobile") setDevice("base"); // a mobile-only app is edited at its one (phone) size
    }
  };

  useEffect(() => {
    let live = true;
    if (isApp) void previewAppIcon(project).then((u) => live && setIcon(u), () => live && setIcon(null));
    return () => { live = false; };
  }, [isApp, project.name, project.app, project.brand?.logoAssetId, project.theme.colors.primary, assets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div role="dialog" aria-label="Project settings" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, width: 500, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>Project settings</h3>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <span style={lab}>Project type</span>
        <div role="radiogroup" aria-label="Project type" style={{ display: "grid", gap: 6 }}>
          {PLATFORMS.map((p) => (
            <button key={p.id} role="radio" aria-checked={project.platform === p.id} onClick={() => setPlatform(p.id)}
              style={{ textAlign: "left", padding: "8px 10px", border: "1px solid " + (project.platform === p.id ? "#2563eb" : "#e5e7eb"), borderRadius: 8, background: project.platform === p.id ? "#eff6ff" : "#fff", cursor: "pointer" }}>
              <b style={{ fontSize: 13 }}>{p.title}</b><br /><span style={{ fontSize: 12, color: "#6b7280" }}>{p.text}</span>
            </button>
          ))}
        </div>
        {project.platform === "mobile" && <p style={{ fontSize: 12, color: "#6b7280" }}>The canvas is a phone screen. Find ready-made screens in Elements &gt; App screens. On a computer the app shows as a phone-width column.</p>}

        {isApp && (
          <div data-testid="app-settings">
            <span style={lab}>App name on the home screen <span style={{ fontWeight: 400, color: "#6b7280" }}>(up to 12 letters)</span></span>
            <input key={app.shortName ?? ""} aria-label="App short name" maxLength={12} defaultValue={app.shortName ?? ""} placeholder={project.name.slice(0, 12)} style={{ ...field, width: "100%" }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (app.shortName ?? "")) setApp("App name", { shortName: v || null }); }} />

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12 }}><span style={lab}>Top bar colour</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="color" aria-label="App theme colour" value={app.themeColor ?? iconBackground(project)} onChange={(e) => setApp("App colour", { themeColor: e.target.value.toUpperCase() })} />
                  {app.themeColor && <button style={{ fontSize: 11 }} onClick={() => setApp("App colour", { themeColor: null })}>Use site colour</button>}
                </span>
              </label>
              <label style={{ fontSize: 12 }}><span style={lab}>Start-up screen colour</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="color" aria-label="App background colour" value={app.backgroundColor ?? (/^#[0-9a-f]{6}$/i.test(project.theme.colors.background) ? project.theme.colors.background : "#ffffff")} onChange={(e) => setApp("Start-up colour", { backgroundColor: e.target.value.toUpperCase() })} />
                  {app.backgroundColor && <button style={{ fontSize: 11 }} onClick={() => setApp("Start-up colour", { backgroundColor: null })}>Use site colour</button>}
                </span>
              </label>
            </div>

            <span style={lab}>When opened from the home screen</span>
            <select aria-label="App display" value={app.display ?? "standalone"} onChange={(e) => setApp("App display", { display: e.target.value })} style={field}>
              <option value="standalone">Like an app (no browser bar)</option>
              <option value="minimal-ui">Like an app, with a small browser bar</option>
              <option value="browser">In the browser</option>
            </select>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
              <input type="checkbox" aria-label="Work offline" checked={app.offline !== false} onChange={(e) => setApp("Offline use", { offline: e.target.checked ? null : false })} />
              Open without a connection after the first visit
            </label>

            <span style={lab}>App icon</span>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {icon && <img src={icon} alt="Your app icon" width={64} height={64} style={{ borderRadius: 14, border: "1px solid #e5e7eb" }} />}
              <div style={{ flex: 1 }}>
                <select aria-label="App icon picture" value={app.iconAssetId ?? ""} onChange={(e) => setApp("App icon", { iconAssetId: e.target.value || null })} style={{ ...field, width: "100%" }}>
                  <option value="">{project.brand?.logoAssetId ? "Use my brand logo" : "Automatic: first letter of the app name"}</option>
                  {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Made into the 192 and 512 pixel icons phones need when you export. A simple, bold picture works best.</div>
              </div>
            </div>

            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 14 }}>
              <b>To install:</b> publish or export, open the site on a phone, then use the browser menu&rsquo;s &ldquo;Add to Home screen&rdquo; or &ldquo;Install app&rdquo;. This is an installable web app, not an App Store / Play Store app.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
