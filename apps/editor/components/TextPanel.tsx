"use client";
import { READY } from "../lib/readymade";
import { TEXT_ITEMS } from "../lib/catalog";
import { FONT_PAIRS } from "../lib/brand";
import { useEditor } from "../lib/store";
import { appendItem, heading, panelStyle, TileGrid, tileBox } from "./Tiles";
import { useDraggable } from "@dnd-kit/core";
import type { CatItem } from "../lib/catalog";

function TextTile({ item, style }: { item: CatItem; style: React.CSSProperties }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${item.key}` });
  const fonts = useEditor((s) => s.project.theme.fonts);
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={() => appendItem(item)} aria-label={item.label}
      style={{ ...tileBox, padding: "12px 14px", borderRadius: 12, opacity: isDragging ? 0.4 : 1, fontFamily: `"${style.fontWeight === 400 ? fonts.body : fonts.heading}", sans-serif`, ...style }}>
      {item.label}
    </button>
  );
}

/** Canva-style "Text": add a text box, default styles, more styles, and font pairs. */
export function TextPanel({ onAskAi }: { onAskAi: () => void }) {
  const { project, commit } = useEditor();
  const fonts = project.theme.fonts;
  const more = READY.filter((r) => r.category === "Text");
  const [h, sub, body] = TEXT_ITEMS;
  return (
    <div style={panelStyle} data-testid="text-panel">
      <button onClick={() => appendItem(body!)} style={{ padding: "11px 12px", border: 0, borderRadius: 10, background: "linear-gradient(90deg,#7c3aed,#9333ea)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>T&nbsp; Add a text box</button>
      <button onClick={onAskAi} style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10, background: "#fff", fontSize: 14, cursor: "pointer" }}>✦&nbsp; Write with AI</button>

      <h4 style={heading}>Default text styles</h4>
      <TextTile item={h!} style={{ fontSize: 24, fontWeight: 700 }} />
      <TextTile item={sub!} style={{ fontSize: 18, fontWeight: 600 }} />
      <TextTile item={body!} style={{ fontSize: 13, fontWeight: 400 }} />

      <h4 style={heading}>More text styles</h4>
      <TileGrid items={more} frame={[200, 76]} columns={2} />

      <h4 style={heading}>Font combinations</h4>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Applies to the whole site. Now: <b>{fonts.heading}</b> + <b>{fonts.body}</b>.</p>
      {FONT_PAIRS.map((f) => {
        const on = fonts.heading === f.heading && fonts.body === f.body;
        return (
          <button key={f.name} aria-label={`Use ${f.name} fonts`} aria-pressed={on} onClick={() => commit({ summary: `Fonts: ${f.name}`, ops: [{ op: "setTheme", theme: { fonts: { heading: f.heading, body: f.body } } }] as never })}
            style={{ ...tileBox, cursor: "pointer", padding: "10px 12px", borderRadius: 10, borderColor: on ? "#2563eb" : "#e5e7eb", background: on ? "#eff6ff" : "#fff" }}>
            <div style={{ fontFamily: `"${f.heading}", sans-serif`, fontSize: 18, fontWeight: 700, color: "#111827" }}>{f.name}</div>
            <div style={{ fontFamily: `"${f.body}", sans-serif`, fontSize: 12, color: "#4b5563" }}>{f.heading} with {f.body}</div>
          </button>
        );
      })}
    </div>
  );
}
