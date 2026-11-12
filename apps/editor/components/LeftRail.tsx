"use client";
import { ICONS } from "@avc/schema";

export type LeftTab = "templates" | "elements" | "text" | "brand" | "blocks" | "media" | "background" | "charts" | "layers" | "pages" | "create";

// Drawn as plain SVG paths (24x24). The ones we have as icons are reused; a few are specific to the rail.
const PATHS: Record<LeftTab, string> = {
  templates: "M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z",
  elements: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  brand: ICONS.award!.d,
  blocks: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  media: ICONS.image!.d,
  background: "M4 20L20 4M4 14L14 4M10 20L20 10M4 8l4-4M16 20l4-4",
  charts: ICONS["bar-chart"]!.d,
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  pages: ICONS.book!.d,
  create: ICONS.sparkles!.d,
};

// `name` keeps the long-standing accessible names (tests and screen-reader users know them); `label` is the short text under the icon.
const ITEMS: { id: LeftTab; label: string; name: string }[] = [
  { id: "templates", label: "Templates", name: "Templates" },
  { id: "elements", label: "Elements", name: "Elements" },
  { id: "text", label: "Text", name: "Text" },
  { id: "brand", label: "Brand", name: "Brand" },
  { id: "blocks", label: "Blocks", name: "Blocks" },
  { id: "media", label: "Media", name: "Media" },
  { id: "background", label: "Background", name: "Background" },
  { id: "charts", label: "Charts", name: "Charts" },
  { id: "layers", label: "Layers", name: "Layers" },
  { id: "pages", label: "Pages", name: "Pages" },
  { id: "create", label: "✦ Create", name: "✦ Create" },
];

/** The vertical strip of tools down the left edge, like Canva's. */
export function LeftRail({ value, onChange }: { value: LeftTab; onChange: (v: LeftTab) => void }) {
  return (
    <div role="tablist" aria-orientation="vertical" aria-label="Tools" style={{ width: 72, flex: "none", borderRight: "1px solid #e5e7eb", background: "#fff", overflowY: "auto", padding: "6px 0" }}>
      {ITEMS.map((it) => {
        const on = value === it.id;
        return (
          <div
            key={it.id} role="tab" aria-selected={on} aria-label={it.name} tabIndex={0} data-rail={it.id}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(it.id); } }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "9px 2px", cursor: "pointer", userSelect: "none", color: on ? "#4f46e5" : "#4b5563" }}
          >
            <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: on ? "#eef2ff" : "transparent", boxShadow: on ? "0 1px 4px rgba(79,70,229,.25)" : "none" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[it.id]} /></svg>
            </span>
            <span aria-hidden="true" style={{ fontSize: 11, lineHeight: 1.1, fontWeight: on ? 600 : 400, textAlign: "center" }}>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}
