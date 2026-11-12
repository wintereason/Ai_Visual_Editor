"use client";
import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Node } from "@avc/schema";
import { LIBRARY } from "../lib/library";
import { READY, READY_CATEGORIES } from "../lib/readymade";
import { appendItem } from "./Tiles";

type Draggable = { key: string; type: string; label: string; make: () => Node };

function Item({ item }: { item: Draggable }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${item.key}` });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => appendItem(item, e.shiftKey)} // Enter adds at the end; Shift+Enter adds next to the selected item
      style={{
        textAlign: "left", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff",
        cursor: "grab", opacity: isDragging ? 0.4 : 1, fontSize: 13, touchAction: "none",
      }}
    >
      {item.label}
    </button>
  );
}

const tab = (on: boolean): React.CSSProperties => ({ flex: 1, padding: "6px 0", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: on ? 600 : 400, borderBottom: on ? "2px solid #2563eb" : "2px solid transparent" });
const chip = (on: boolean): React.CSSProperties => ({ padding: "3px 9px", border: "1px solid " + (on ? "#2563eb" : "#d1d5db"), borderRadius: 999, background: on ? "#eff6ff" : "#fff", color: on ? "#1d4ed8" : "#374151", cursor: "pointer", fontSize: 12 });

function ReadyMade() {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = READY.filter((r) => (cat === "All" || r.category === cat) && (!needle || `${r.label} ${r.category}`.toLowerCase().includes(needle)));
  return (
    <div data-testid="ready-made" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input aria-label="Search ready-made items" placeholder={`Search ${READY.length} ready-made items`} value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {READY_CATEGORIES.map((c) => <button key={c} style={chip(c === cat)} aria-pressed={c === cat} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {shown.length === 0 && <p style={{ fontSize: 12, color: "#6b7280" }}>Nothing matches. Try another word.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {shown.map((r) => <Item key={r.key} item={r} />)}
      </div>
      <p style={{ fontSize: 12, color: "#6b7280" }}>Drag onto the canvas, or click to append. Then change the words, colours and pictures in the right-hand panel.</p>
    </div>
  );
}

export function Palette() {
  const [mode, setMode] = useState<"basics" | "ready">("basics");
  const groups = ["Structure", "Elements", "Blocks"] as const;
  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div role="tablist" style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
        <button role="tab" aria-selected={mode === "basics"} style={tab(mode === "basics")} onClick={() => setMode("basics")}>Basics</button>
        <button role="tab" aria-selected={mode === "ready"} style={tab(mode === "ready")} onClick={() => setMode("ready")}>Ready-made</button>
      </div>
      {mode === "ready" ? <ReadyMade /> : (
        <>
          {groups.map((g) => (
            <div key={g}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", marginBottom: 6 }}>{g}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {LIBRARY.filter((i) => i.group === g).map((i) => <Item key={i.type} item={{ ...i, key: i.type }} />)}
              </div>
            </div>
          ))}
          <p style={{ fontSize: 12, color: "#6b7280" }}>Drag onto the canvas, or click to append. Keyboard: Enter adds at the end of the page; Shift + Enter adds inside or after the selected item.</p>
        </>
      )}
    </div>
  );
}
