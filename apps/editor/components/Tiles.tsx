"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChartEl, IconEl, ShapeEl, renderDocument } from "@avc/renderer";
import type { Node, Project, Theme } from "@avc/schema";
import type { CatItem } from "../lib/catalog";
import { LIBRARY } from "../lib/library";
import { canContain, getDef } from "@avc/schema";
import { announce, findNode, newId, useEditor } from "../lib/store";

/** Click-to-add: a new section at the end of the page holding the item. Dragging gives precise placement instead. */
export function appendItem(item: { label: string; type: string; make: () => Node }, nextToSelection = false) {
  const { project, pageId, commit, selection } = useEditor.getState();
  const page = project.pages.find((p) => p.id === pageId)!;
  const node = item.make();
  // With Shift (keyboard or mouse): put it inside the selected container if it fits, else right after the selected item if that fits.
  const sel = nextToSelection && selection ? findNode(project, selection) : null;
  if (sel && item.type !== "section" && canContain(sel.node.type, item.type)) {
    if (commit({ summary: `Add ${item.label}`, ops: [{ op: "insert", parentId: sel.node.id, index: sel.node.children?.length ?? 0, node }] }, { select: node.id })) announce(`Added ${item.label} inside ${sel.node.type}.`);
    return;
  }
  if (sel) {
    const parentType = sel.parentId === pageId ? null : findNode(project, sel.parentId)?.node.type ?? null;
    const fits = parentType === null ? !!getDef(item.type)?.topLevelOnly : canContain(parentType, item.type);
    if (fits) {
      if (commit({ summary: `Add ${item.label}`, ops: [{ op: "insert", parentId: sel.parentId, index: sel.index + 1, node }] }, { select: node.id })) announce(`Added ${item.label} after ${sel.node.type}.`);
      return;
    }
  }
  const wrapped = item.type === "section" ? node : { ...LIBRARY[0]!.make(), children: [node] };
  if (commit({ summary: `Add ${item.label}`, ops: [{ op: "insert", parentId: pageId, index: page.nodes.length, node: wrapped }] }, { select: node.id })) announce(`Added ${item.label} at the end of the page.`);
}

const themeVars = (t: Theme) => Object.fromEntries(Object.entries(t.colors).map(([k, v]) => [`--c-${k}`, v])) as React.CSSProperties;

/** Shows `children` only once the tile is near the screen: a panel can hold hundreds of previews and must not render them all at once. */
function useNearScreen(): [React.RefObject<HTMLDivElement>, boolean, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return () => ro.disconnect(); }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);
  return [ref, seen, width];
}

/** A real rendering of `nodes` with the current theme, scaled down to fit the tile. */
export function FramePreview({ nodes, frame, theme, pageBg = true, asPage = false }: { nodes: Node[]; frame: [number, number]; theme: Theme; pageBg?: boolean; /** nodes are already top-level page sections */ asPage?: boolean }) {
  const [ref, seen, width] = useNearScreen();
  const [fw, fh] = frame;
  const scale = width > 0 ? width / fw : 0.2;
  const doc = useMemo(() => {
    if (!seen) return "";
    const project = { id: "preview", name: "preview", theme, pages: [{ id: "p", name: "p", path: "/", nodes: asPage ? nodes : [{ id: newId("pv"), kind: "container", type: "section", props: {}, children: nodes } as Node] }], assets: [] } as unknown as Project;
    return renderDocument(project, "p").replace("<body>", `<body style="${pageBg ? "" : "background:transparent;"}overflow:hidden">`);
  }, [seen, nodes, theme, pageBg, asPage]);
  return (
    <div ref={ref} style={{ width: "100%", height: Math.round(fh * scale), overflow: "hidden", position: "relative", background: "#fff" }}>
      {seen && <iframe title="preview" srcDoc={doc} tabIndex={-1} aria-hidden="true" sandbox="" style={{ width: fw, height: fh, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none", position: "absolute", left: 0, top: 0 }} />}
    </div>
  );
}

/** Small graphics are drawn directly (no frame): crisp at any size and cheap in bulk. */
function Preview({ item, frame }: { item: CatItem; frame: [number, number] }) {
  const theme = useEditor((s) => s.project.theme);
  const node = useMemo(() => item.make(), [item]);
  const p = node.props as Record<string, unknown>;
  if (node.type === "shape" || node.type === "icon") {
    return (
      <div style={{ ...themeVars(theme), display: "grid", placeItems: "center", height: 72, color: "var(--c-primary)" }}>
        <div style={{ width: node.type === "shape" ? 48 : 40, height: node.type === "shape" ? 48 : 40, display: "grid" }}>
          {node.type === "shape" ? <ShapeEl shape={p.shape} common={{ style: { width: "100%" } }} /> : <IconEl name={p.name} common={{ style: { width: "100%", height: "100%" } }} />}
        </div>
      </div>
    );
  }
  if (node.type === "chart") {
    return <div style={{ ...themeVars(theme), padding: 6, background: "#fff" }}><ChartEl chartType={p.chartType as never} title={p.title} data={p.data} common={{ style: { width: "100%" } }} /></div>;
  }
  return <FramePreview nodes={[node]} frame={frame} theme={theme} />;
}

export const tileBox: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", overflow: "hidden", cursor: "grab", textAlign: "left", padding: 0, display: "block", width: "100%", touchAction: "none" };

/** One draggable, clickable thing in a panel, shown the way it will look. */
export function ItemTile({ item, frame, showLabel = true }: { item: CatItem; frame: [number, number]; showLabel?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${item.key}` });
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={(e) => appendItem(item, e.shiftKey)} title={item.label} aria-label={item.label}
      style={{ ...tileBox, opacity: isDragging ? 0.4 : 1 }}>
      <Preview item={item} frame={frame} />
      {showLabel && <div style={{ padding: "4px 8px", fontSize: 11, color: "#374151", borderTop: "1px solid #f3f4f6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</div>}
    </button>
  );
}

type Frame = [number, number];
export function TileGrid({ items, frame, columns, showLabel = true }: { items: CatItem[]; frame: Frame | ((i: CatItem) => Frame); columns: 1 | 2 | 3; showLabel?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8 }}>
      {items.map((i) => <ItemTile key={i.key} item={i} frame={typeof frame === "function" ? frame(i) : frame} showLabel={showLabel} />)}
    </div>
  );
}

export const panelStyle: React.CSSProperties = { padding: 12, display: "flex", flexDirection: "column", gap: 12 };
export const searchBox: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 999, fontSize: 13, boxSizing: "border-box", background: "#fff" };
export const heading: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#111827", margin: 0 };
export const chipStyle = (on: boolean): React.CSSProperties => ({ padding: "3px 10px", border: "1px solid " + (on ? "#2563eb" : "#d1d5db"), borderRadius: 999, background: on ? "#eff6ff" : "#fff", color: on ? "#1d4ed8" : "#374151", cursor: "pointer", fontSize: 12 });
