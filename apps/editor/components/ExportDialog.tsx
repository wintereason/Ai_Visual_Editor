"use client";
import { collectAssetIds, lintProject } from "@avc/schema";
import { pageFile, renderDocument } from "@avc/renderer";
import { buildSite } from "@avc/publisher";
import { strToU8, zipSync } from "fflate";
import { useState } from "react";
import { FormsSection, hasContactForm, type FormsConnect } from "./FormsSection";
import { AnalyticsSection } from "./AnalyticsSection";
import { PublishSection } from "./PublishSection";
import { getAllAssets } from "../lib/assets";
import { makeAppIcons } from "../lib/appIcon";
import { useEditor } from "../lib/store";

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, pageId, select, setPage, assets, assetUrls } = useEditor();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [forms, setForms] = useState<FormsConnect | null>(null);
  const [analytics, setAnalytics] = useState<string | null>(null);
  const addressBad = baseUrl.trim() !== "" && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(baseUrl.trim());
  const showForms = hasContactForm(JSON.stringify(project.pages));
  const issues = lintProject(project, { assetIds: new Set(assets.map((a) => a.id)) });
  const errors = issues.filter((i) => i.severity === "error");

  /** Builds the site exactly as a server would (validates, re-verifies every image from its bytes, adds SEO tags, a strict CSP,
   *  security headers, 404, robots and, with an address, a sitemap). Returns null and shows the reasons if it can't. */
  const buildFiles = async (address: string = baseUrl): Promise<Record<string, Uint8Array> | null> => {
    setFailures([]);
    try {
      const used = collectAssetIds(project);
      const stored = (await getAllAssets()).filter((s) => used.has(s.asset.id));
      const library = await Promise.all(stored.map(async (s) => ({ asset: s.asset, bytes: new Uint8Array(await s.blob.arrayBuffer()) })));
      // An installable app (mobile / website + app) needs its two icons; they are drawn here from the app icon, brand logo or app name.
      const appIcons = project.platform !== "web" ? await makeAppIcons(project) : [];
      const result = await buildSite(project, library, { baseUrl: address, ...(showForms && forms ? { forms } : {}), ...(analytics ? { analytics: { token: analytics } } : {}), ...(project.platform !== "web" ? { app: { icons: appIcons } } : {}) });
      if (!result.ok) { setFailures(result.errors); return null; }
      return result.files;
    } catch {
      setFailures(["Couldn't build the site. Check that media storage is available and try again."]);
      return null;
    }
  };
  const exportZip = async () => {
    setBusy(true);
    try {
      const files = await buildFiles();
      if (!files) return;
      const slug = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "site";
      download(new Blob([zipSync(files) as BlobPart], { type: "application/zip" }), `${slug}.zip`);
    } finally {
      setBusy(false);
    }
  };
  const preview = () => {
    const page = project.pages.find((p) => p.id === pageId)!;
    const url = URL.createObjectURL(new Blob([renderDocument(project, page.id, { assetUrl: (id) => assetUrls[id] })], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const go = (i: (typeof issues)[number]) => {
    if (i.pageId) setPage(i.pageId);
    if (i.nodeId) setTimeout(() => select(i.nodeId!), 0);
    onClose();
  };
  const btn: React.CSSProperties = { padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer" };

  return (
    <div role="dialog" aria-label="Export" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 20, width: 460, maxHeight: "80vh", overflow: "auto" }}>
        <h3 style={{ margin: "0 0 4px" }}>Export site</h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
          {project.pages.length} page{project.pages.length > 1 ? "s" : ""} → {project.pages.map((p) => pageFile(p.path)).join(", ")}
        </p>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Pre-publish check</div>
        {issues.length === 0 ? (
          <div style={{ fontSize: 13, color: "#15803d" }}>✔ No issues found</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
            {issues.map((i, k) => (
              <li key={k} style={{ padding: "4px 0", display: "flex", gap: 6 }}>
                <span>{i.severity === "error" ? "✖" : "⚠"}</span>
                <span style={{ flex: 1, color: i.severity === "error" ? "#b91c1c" : "#92400e" }}>{i.message}</span>
                {(i.nodeId || i.pageId) && <button onClick={() => go(i)} style={{ fontSize: 11 }}>Go</button>}
              </li>
            ))}
          </ul>
        )}
        <label style={{ display: "block", marginTop: 14, fontSize: 13 }}>
          Site address <span style={{ color: "#6b7280" }}>(optional, enables canonical links and sitemap)</span>
          <input aria-label="Site address" type="url" name="site-address" autoComplete="off" placeholder="https://www.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginTop: 4, padding: 6, border: "1px solid #d1d5db", borderRadius: 4 }} />
        </label>
        {addressBad && <div role="alert" data-testid="address-error" style={{ marginTop: 4, color: "#b91c1c", fontSize: 12 }}>That isn't a web address. Use something like https://www.example.com, or leave it empty.</div>}
        {showForms && <FormsSection projectName={project.name} onChange={setForms} />}
        <AnalyticsSection onChange={setAnalytics} />
        <PublishSection projectName={project.name} blocked={errors.length > 0 || addressBad} build={buildFiles} baseUrl={baseUrl} onAddress={setBaseUrl} />
        {failures.length > 0 && (
          <div role="alert" data-testid="build-errors" style={{ marginTop: 10, color: "#b91c1c", fontSize: 13 }}>
            <b>Couldn't build the site:</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{failures.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Close</button>
          <button style={btn} onClick={preview}>Preview page ↗</button>
          <button style={{ ...btn, background: errors.length ? "#e5e7eb" : "#2563eb", color: errors.length ? "#6b7280" : "#fff" }} disabled={errors.length > 0 || addressBad || busy} onClick={() => void exportZip()} title={errors.length ? "Fix errors first" : ""}>
            {busy ? "Exporting…" : "⬇ Download .zip"}
          </button>
        </div>
      </div>
    </div>
  );
}
