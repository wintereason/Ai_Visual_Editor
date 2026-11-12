"use client";
import { useState } from "react";
import { newId, useEditor } from "../lib/store";
import { LegalPages } from "./LegalPages";

const field: React.CSSProperties = { width: "100%", padding: "5px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "8px 0 3px", display: "block" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function PagesPanel() {
  const { project, pageId, setPage, commit } = useEditor();
  const [newName, setNewName] = useState("");
  const page = project.pages.find((p) => p.id === pageId)!;

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    let path = "/" + (slug(name) || "page");
    for (let i = 2; project.pages.some((p) => p.path === path); i++) path = `/${slug(name) || "page"}-${i}`;
    const id = newId("page");
    if (commit({ summary: `Add page ${name}`, ops: [{ op: "addPage", page: { id, name, path, seo: { title: name }, nodes: [] } }] })) {
      setPage(id);
      setNewName("");
    }
  };
  const update = (patch: { name?: string; path?: string; seo?: { title?: string; description?: string } }) =>
    commit({ summary: "Edit page", ops: [{ op: "updatePage", id: page.id, ...patch }] });

  return (
    <div style={{ padding: 12 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {project.pages.map((p) => (
          <li key={p.id}>
            <button
              data-testid={`page-${p.path}`}
              onClick={() => setPage(p.id)}
              style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: 0, borderRadius: 4, background: p.id === pageId ? "#dbeafe" : "transparent", cursor: "pointer", fontSize: 13 }}
            >
              {p.name} <span style={{ color: "#6b7280", fontSize: 11 }}>{p.path}</span>
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New page name" style={{ ...field, flex: 1 }} />
        <button onClick={add} style={{ padding: "4px 8px", cursor: "pointer" }}>Add</button>
      </div>

      <LegalPages />
      <div style={{ borderTop: "1px solid #e5e7eb", margin: "14px 0 4px" }} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>Page settings</div>
      {/* key forces uncontrolled inputs to reset when switching pages / after undo */}
      <div key={page.id + JSON.stringify([page.name, page.path, page.seo])}>
        <span style={label}>Name</span>
        <input aria-label="Page name" style={field} defaultValue={page.name} onBlur={(e) => e.target.value.trim() && e.target.value !== page.name && update({ name: e.target.value.trim() })} />
        <span style={label}>Path</span>
        <input aria-label="Page path" style={field} defaultValue={page.path} onBlur={(e) => e.target.value !== page.path && update({ path: e.target.value })} />
        <span style={label}>SEO title</span>
        <input aria-label="SEO title" style={field} defaultValue={page.seo?.title ?? ""} onBlur={(e) => e.target.value !== (page.seo?.title ?? "") && update({ seo: { title: e.target.value } })} />
        <span style={label}>SEO description</span>
        <textarea aria-label="SEO description" style={{ ...field, minHeight: 56 }} defaultValue={page.seo?.description ?? ""} onBlur={(e) => e.target.value !== (page.seo?.description ?? "") && update({ seo: { description: e.target.value } })} />
      </div>
      <button
        disabled={project.pages.length <= 1}
        onClick={() => confirm(`Delete page "${page.name}"?`) && commit({ summary: "Delete page", ops: [{ op: "removePage", id: page.id }] }, { select: null })}
        style={{ marginTop: 12, padding: "4px 10px", cursor: "pointer", color: "#b91c1c" }}
      >
        Delete page
      </button>
    </div>
  );
}
