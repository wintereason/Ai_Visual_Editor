"use client";
import { useState } from "react";
import { downloadJson } from "../lib/persist";
import { useEffect } from "react";
import { useCloud } from "../lib/cloud";
import { useEditor } from "../lib/store";

export function HistoryPanel() {
  const { versions, saveVersion, restoreVersion, project, saveStatus } = useEditor();
  const [label, setLabel] = useState("");
  const { user, cloudId, versions: cloudVersions, versionsLoading, refreshVersions, restoreVersion: restoreCloud, saveSnapshot, sync } = useCloud();
  const linked = !!user && !!cloudId;
  useEffect(() => { if (linked) void refreshVersions(); }, [linked, cloudId, refreshVersions]);
  const btn: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>Version history</div>
      <p style={{ fontSize: 12, color: "#6b7280" }}>Autosaved in this browser. Restoring creates an undoable change; nothing is lost.</p>
      <div style={{ display: "flex", gap: 4 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Version name" style={{ flex: 1, padding: 4, border: "1px solid #d1d5db", borderRadius: 4 }} />
        <button style={btn} onClick={() => { const l = label.trim() || "Manual save"; saveVersion(l); if (linked) void saveSnapshot(l); setLabel(""); }}>Save</button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
        <li style={{ padding: "6px 0", color: "#2563eb" }}>● Now {saveStatus === "error" && "(not saved!)"}</li>
        {versions.map((v) => (
          <li key={v.id} style={{ padding: "6px 0", borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1 }}>
              {v.label}
              <br />
              <span style={{ fontSize: 11, color: "#6b7280" }}>{new Date(v.at).toLocaleString()}</span>
            </span>
            <button style={btn} onClick={() => restoreVersion(v.id)}>Restore</button>
          </li>
        ))}
        {versions.length === 0 && <li style={{ color: "#6b7280", fontSize: 12 }}>No saved versions yet.</li>}
      </ul>
      {linked && (
        <div data-testid="cloud-history" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <b style={{ flex: 1 }}>☁ Cloud history</b>
            <button style={btn} onClick={() => void refreshVersions()} disabled={versionsLoading}>{versionsLoading ? "…" : "Refresh"}</button>
          </div>
          <p style={{ fontSize: 11, color: "#6b7280", margin: "4px 0" }}>Saved on the server, so it is available on every device you sign in on.{sync === "conflict" ? " Resolve the conflict banner before restoring." : ""}</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {cloudVersions.map((v) => (
              <li key={v.id} data-testid={`cloud-version-${v.version}`} style={{ padding: "6px 0", borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: 1 }}>
                  {v.reason} <span style={{ color: "#9ca3af", fontSize: 11 }}>v{v.version}</span>
                  <br />
                  <span style={{ fontSize: 11, color: "#6b7280" }}>{new Date(v.createdAt).toLocaleString()}</span>
                </span>
                <button style={btn} disabled={sync === "conflict"} onClick={() => confirm("Replace the open project with this cloud version? You can undo it.") && void restoreCloud(v.id)}>Restore</button>
              </li>
            ))}
            {cloudVersions.length === 0 && !versionsLoading && <li style={{ color: "#6b7280", fontSize: 12 }}>No cloud versions yet.</li>}
          </ul>
        </div>
      )}
      <button style={btn} onClick={() => downloadJson(project)}>⬇ Download JSON backup</button>
    </div>
  );
}
