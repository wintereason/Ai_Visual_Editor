"use client";
import { useState } from "react";
import { ICONS } from "@avc/schema";
import { APP_FRAMES, CATEGORIES, SECTION_FRAMES, searchItems, type Category } from "../lib/catalog";
import { chipStyle, heading, panelStyle, searchBox, TileGrid } from "./Tiles";

function CategoryTile({ c, onOpen }: { c: Category; onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-label={`${c.label} (${c.items.length})`} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <span style={{ width: 64, height: 64, borderRadius: 16, background: `linear-gradient(135deg, ${c.colors[0]}, ${c.colors[1]})`, display: "grid", placeItems: "center", boxShadow: "6px 6px 0 rgba(0,0,0,.07)" }}>
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[c.icon]?.d ?? ""} /></svg>
      </span>
      <span style={{ fontSize: 12, color: "#111827" }}>{c.label}</span>
    </button>
  );
}

/** Canva-style "Elements": search everything, or browse by category. */
export function ElementsPanel() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [chip, setChip] = useState("All");
  const cat = CATEGORIES.find((c) => c.id === open);
  const results = q.trim() ? searchItems(q) : null;
  const items = cat ? cat.items.filter((i) => chip === "All" || i.category === chip) : [];

  return (
    <div style={panelStyle} data-testid="elements-panel">
      <input aria-label="Search elements" placeholder="Search elements" value={q} onChange={(e) => setQ(e.target.value)} style={searchBox} />
      {results ? (
        <>
          <h4 style={heading}>{results.length} result{results.length === 1 ? "" : "s"}</h4>
          {results.length === 0 && <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Nothing matches. Try a different word, like “arrow”, “star”, “price” or “map”.</p>}
          <TileGrid items={results} frame={(i) => (i.category === "App screens" ? APP_FRAMES[i.type] ?? [390, 260] : i.type === "section" || SECTION_FRAMES[i.category] ? SECTION_FRAMES[i.category] ?? [800, 400] : [300, 220])} columns={2} />
        </>
      ) : cat ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button aria-label="Back to all categories" onClick={() => { setOpen(null); setChip("All"); }} style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 999, cursor: "pointer", width: 28, height: 28 }}>←</button>
            <h4 style={heading}>{cat.label}</h4>
            <span style={{ fontSize: 12, color: "#6b7280" }}>{cat.items.length} items</span>
          </div>
          {cat.chips && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {["All", ...cat.chips].map((c) => <button key={c} style={chipStyle(c === chip)} aria-pressed={c === chip} onClick={() => setChip(c)}>{c}</button>)}
            </div>
          )}
          <TileGrid items={items} frame={cat.id === "sections" ? (i) => SECTION_FRAMES[i.category] ?? cat.frame : cat.id === "app" ? (i) => APP_FRAMES[i.type] ?? cat.frame : cat.frame} columns={cat.columns} />
          <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Drag onto the canvas, or click to add. Then change it in the right-hand panel.</p>
        </>
      ) : (
        <>
          <h4 style={heading}>Browse categories</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, padding: "4px 0" }}>
            {CATEGORIES.map((c) => <CategoryTile key={c.id} c={c} onOpen={() => setOpen(c.id)} />)}
          </div>
        </>
      )}
    </div>
  );
}
