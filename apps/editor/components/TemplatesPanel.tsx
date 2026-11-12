"use client";
import { useMemo, useState } from "react";
import { TEMPLATES } from "@avc/templates";
import type { Node, Theme } from "@avc/schema";
import { cloneWithNewIds, newId, useEditor } from "../lib/store";
import { chipStyle, FramePreview, heading, panelStyle, searchBox, tileBox } from "./Tiles";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

type Entry = { key: string; templateTitle: string; topic: string; name: string; nodes: Node[]; theme: Theme; tags: string };

/** Canva-style "Templates": see ready-made pages as they will look, and add one to your site. */
export function TemplatesPanel({ onNewSite }: { onNewSite: () => void }) {
  const { project, commit, setPage } = useEditor();
  const [q, setQ] = useState("");
  const [tpl, setTpl] = useState("All");
  const [useLook, setUseLook] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const entries = useMemo<Entry[]>(() => TEMPLATES.flatMap((t) => {
    const p = t.make();
    return p.pages.map((pg) => ({ key: `${t.id}:${pg.id}`, templateTitle: t.title, topic: t.topic, name: pg.name, nodes: pg.nodes, theme: p.theme, tags: t.tags.join(" ") }));
  }), []);
  const needle = q.trim().toLowerCase();
  const shown = entries.filter((e) => (tpl === "All" || e.templateTitle === tpl) && (!needle || `${e.name} ${e.templateTitle} ${e.tags}`.toLowerCase().includes(needle)));

  const add = (e: Entry) => {
    let path = "/" + (slug(e.name) || "page");
    for (let i = 2; project.pages.some((p) => p.path === path); i++) path = `/${slug(e.name) || "page"}-${i}`;
    const id = newId("page");
    const ops: object[] = [{ op: "addPage", page: { id, name: e.name, path, seo: { title: e.name }, nodes: e.nodes.map(cloneWithNewIds) } }];
    if (useLook) ops.push({ op: "setTheme", theme: e.theme });
    if (commit({ summary: `Add page ${e.name}`, ops: ops as never })) { setPage(id); setDone(`Added “${e.name}” as a new page.`); }
  };

  return (
    <div style={panelStyle} data-testid="templates-panel">
      <input aria-label="Search templates" placeholder="Search page templates" value={q} onChange={(e) => setQ(e.target.value)} style={searchBox} />
      <button onClick={onNewSite} style={{ padding: "9px 12px", border: "1px solid #2563eb", borderRadius: 10, background: "#eff6ff", color: "#1d4ed8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Start a whole new site…</button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {["All", ...TEMPLATES.map((t) => t.title)].map((t) => <button key={t} style={chipStyle(t === tpl)} aria-pressed={t === tpl} onClick={() => setTpl(t)}>{t}</button>)}
      </div>
      <label style={{ fontSize: 12, color: "#374151", display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={useLook} onChange={(e) => setUseLook(e.target.checked)} /> Also use its colours and fonts
      </label>
      {done && <div role="status" style={{ fontSize: 12, color: "#15803d" }}>✔ {done}</div>}
      <h4 style={heading}>Pages</h4>
      {shown.length === 0 && <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Nothing matches.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {shown.map((e) => (
          <button key={e.key} onClick={() => add(e)} aria-label={`Add page: ${e.name} (${e.templateTitle})`} style={{ ...tileBox, cursor: "pointer" }}>
            <FramePreview nodes={e.nodes} frame={[1200, 900]} theme={e.theme} asPage />
            <div style={{ padding: "4px 8px", fontSize: 11, color: "#374151", borderTop: "1px solid #f3f4f6" }}><b>{e.name}</b><br /><span style={{ color: "#6b7280" }}>{e.templateTitle}</span></div>
          </button>
        ))}
      </div>
    </div>
  );
}
