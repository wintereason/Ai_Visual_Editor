"use client";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { canContain, type Node } from "@avc/schema";
import { createContext, useContext, useState } from "react";
import { announce, findNode, keyboardMove, useEditor } from "../lib/store";

const TEXT_KEYS = ["text", "headline", "label", "title", "brand", "quote", "copyright"];
const preview = (n: Node) => {
  const k = TEXT_KEYS.find((k) => typeof n.props[k] === "string" && n.props[k]);
  return k ? String(n.props[k]).slice(0, 24) : "";
};

export type DropZone = "before" | "inside" | "after";
export type LayerTarget = { parentId: string; index: number } | null;

/**
 * Where would dropping `srcId` on row `rowId` (at pointer height `y`) put it? Pure, so it is unit-testable and shared
 * by the live indicator and the actual drop. Returns null when the move is not allowed (registry rules, own subtree).
 */
export function resolveLayerDrop(
  project: Parameters<typeof findNode>[0],
  pageId: string,
  srcId: string,
  rowId: string,
  zone: DropZone,
): LayerTarget {
  const src = findNode(project, srcId);
  if (!src) return null;
  const page = project.pages.find((p) => p.id === pageId)!;

  const subtree = new Set<string>();
  const collect = (n: Node) => { subtree.add(n.id); n.children?.forEach(collect); };
  collect(src.node);

  // The end-of-list zone: append at page level (only sections may live there)
  if (rowId === "end") return src.node.type === "section" ? { parentId: pageId, index: page.nodes.length - (src.parentId === pageId ? 1 : 0) } : null;

  const row = findNode(project, rowId);
  if (!row || subtree.has(rowId)) return null; // dropping onto itself or its own descendant

  const parentType = (id: string) => (id === pageId ? "(page)" : findNode(project, id)?.node.type);
  const allowed = (parentId: string) => {
    if (subtree.has(parentId)) return false;
    return parentId === pageId ? src.node.type === "section" : canContain(parentType(parentId)!, src.node.type);
  };

  if (zone === "inside") {
    if (!allowed(row.node.id)) return null;
    const count = row.node.children?.length ?? 0;
    return { parentId: row.node.id, index: count - (src.parentId === row.node.id ? 1 : 0) };
  }
  if (!allowed(row.parentId)) return null;
  // `move` removes the node first and then inserts, so indexes after it in the same parent shift down by one.
  const shift = src.parentId === row.parentId && src.index < row.index ? 1 : 0;
  return { parentId: row.parentId, index: row.index + (zone === "after" ? 1 : 0) - shift };
}

type Indicator = { rowId: string; zone: DropZone; ok: boolean } | null;
const IndicatorCtx = createContext<Indicator>(null);

function Row({ node, depth, parentId, index, siblings }: { node: Node; depth: number; parentId: string; index: number; siblings: number }) {
  const { selection, select, commit } = useEditor();
  const indicator = useContext(IndicatorCtx);
  const [open, setOpen] = useState(true);
  const selected = selection === node.id;
  const hidden = !!node.styles?.base?.normal?.hidden;
  const kids = node.children ?? [];
  const small: React.CSSProperties = { border: 0, background: "transparent", cursor: "pointer", padding: "0 3px", fontSize: 12 };
  // Only the selected row's small buttons are Tab stops, so the whole tree isn't dozens of stops long.
  const stop = selected ? 0 : -1;
  const isFirst = depth === 0 && index === 0;

  /** Tree keys: Up/Down move through the visible rows, Right/Left open/close or step into/out of a row, Home/End jump. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return; // keys meant for the buttons inside, or the editor's own shortcuts
    const tree = e.currentTarget.closest('[role="tree"]');
    const items = tree ? [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [];
    const i = items.indexOf(e.currentTarget);
    const go = (el?: HTMLElement) => {
      if (!el) return;
      e.preventDefault();
      el.focus();
      select(el.dataset.layerId!);
      announce(`${el.getAttribute("aria-label") ?? "Item"} selected`);
    };
    switch (e.key) {
      case "ArrowDown": go(items[i + 1]); break;
      case "ArrowUp": go(items[i - 1]); break;
      case "Home": go(items[0]); break;
      case "End": go(items[items.length - 1]); break;
      case "ArrowRight":
        if (kids.length) { e.preventDefault(); if (!open) setOpen(true); else go(items[i + 1]); }
        break;
      case "ArrowLeft":
        if (kids.length && open) { e.preventDefault(); setOpen(false); }
        else go(items.slice(0, i).reverse().find((x) => Number(x.getAttribute("aria-level")) === depth));
        break;
      case "Enter": case " ": e.preventDefault(); select(node.id); break;
    }
  };

  const drag = useDraggable({ id: `layer:${node.id}` });
  const mine = indicator?.rowId === node.id ? indicator : null;
  const line = mine && mine.zone !== "inside" ? `2px solid ${mine.ok ? "#2563eb" : "#dc2626"}` : undefined;

  return (
    <>
      <div
        ref={drag.setNodeRef}
        data-layer-id={node.id}
        data-testid={`layer-${node.id}`}
        role="treeitem" aria-level={depth + 1} aria-selected={selected} aria-expanded={kids.length ? open : undefined}
        aria-label={`${node.type} ${preview(node)}`.trim() + `, level ${depth + 1}, ${index + 1} of ${siblings}${hidden ? ", hidden" : ""}`}
        tabIndex={selected || (isFirst && !useEditor.getState().selection) ? 0 : -1}
        onKeyDown={onKeyDown}
        data-drop={mine ? `${mine.zone}:${mine.ok ? "ok" : "refused"}` : undefined}
        onClick={() => select(node.id)}
        style={{
          display: "flex", alignItems: "center", gap: 2, padding: "3px 6px", paddingLeft: 6 + depth * 12,
          background: mine?.zone === "inside" ? (mine.ok ? "#bfdbfe" : "#fecaca") : selected ? "#dbeafe" : "transparent",
          cursor: "pointer", fontSize: 12, opacity: drag.isDragging ? 0.4 : hidden ? 0.5 : 1,
          borderTop: mine?.zone === "before" ? line : "2px solid transparent",
          borderBottom: mine?.zone === "after" ? line : "2px solid transparent",
        }}
      >
        <button
          ref={drag.setActivatorNodeRef} {...drag.listeners} {...drag.attributes}
          aria-label={`Drag ${node.type}. With the keyboard, use Alt and the arrow keys instead.`} title="Drag to reorder" tabIndex={stop} onClick={(e) => e.stopPropagation()}
          style={{ ...small, cursor: "grab", touchAction: "none", color: "#9ca3af" }}
        >⠿</button>
        <button aria-label={open ? "Collapse" : "Expand"} tabIndex={stop} style={{ ...small, visibility: kids.length ? "visible" : "hidden" }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? "▾" : "▸"}</button>
        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <b>{node.type}</b> <span style={{ color: "#6b7280" }}>{preview(node)}</span>
        </span>
        {selected && (
          <>
            <button style={small} title="Nest into the item above" aria-label="Nest into the item above" onClick={(e) => { e.stopPropagation(); keyboardMove(node.id, "indent"); }}>⇥</button>
            <button style={small} title="Move out of its parent" aria-label="Move out of its parent" onClick={(e) => { e.stopPropagation(); keyboardMove(node.id, "outdent"); }}>⇤</button>
            <button style={small} title="Move up" disabled={index === 0} onClick={(e) => { e.stopPropagation(); commit({ summary: "Move up", ops: [{ op: "move", id: node.id, parentId, index: index - 1 }] }); }}>↑</button>
            <button style={small} title="Move down" disabled={index >= siblings - 1} onClick={(e) => { e.stopPropagation(); commit({ summary: "Move down", ops: [{ op: "move", id: node.id, parentId, index: index + 1 }] }); }}>↓</button>
          </>
        )}
        <button
          style={small}
          title={hidden ? "Show" : "Hide"} aria-label={hidden ? "Show" : "Hide"} tabIndex={stop}
          onClick={(e) => { e.stopPropagation(); commit({ summary: hidden ? "Show" : "Hide", ops: [{ op: "update", id: node.id, styles: { base: { normal: { hidden: hidden ? null : true } } } }] }); }}
        >{hidden ? "🙈" : "👁"}</button>
      </div>
      {open && kids.map((c, i) => <Row key={c.id} node={c} depth={depth + 1} parentId={node.id} index={i} siblings={kids.length} />)}
    </>
  );
}

function EndZone({ indicator }: { indicator: Indicator }) {
  const on = indicator?.rowId === "end";
  return <div data-layer-id="end" data-testid="layer-end" style={{ height: 24, margin: "4px 8px", borderRadius: 4, border: on ? `2px dashed ${indicator!.ok ? "#2563eb" : "#dc2626"}` : "2px dashed transparent" }} />;
}

/**
 * The layer row under a screen point, found by hit-testing the live DOM (not cached drag-and-drop rectangles, which can
 * be a few pixels stale). Elements are checked front-to-back, so the drag overlay never gets in the way.
 */
export function rowAtPoint(x: number, y: number): { rowId: string; rect: DOMRect } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const row = (el as HTMLElement).closest?.("[data-layer-id]") as HTMLElement | null;
    if (row) return { rowId: row.dataset.layerId!, rect: row.getBoundingClientRect() };
  }
  return null;
}

/** Pointer height within the hovered row decides before / inside / after. */
export function zoneFor(rect: { top: number; height: number }, y: number): DropZone {
  const f = (y - rect.top) / Math.max(rect.height, 1);
  return f < 0.3 ? "before" : f > 0.7 ? "after" : "inside";
}

export function LayersPanel() {
  const { project, pageId } = useEditor();
  const page = project.pages.find((p) => p.id === pageId)!;
  const [indicator, setIndicator] = useState<Indicator>(null);

  // Live feedback while a layer is being dragged: which row, which zone, and whether the drop would be allowed.
  useDndMonitor({
    onDragMove(e) {
      const id = String(e.active.id);
      if (!id.startsWith("layer:")) return;
      const ev = e.activatorEvent as PointerEvent;
      const x = ev.clientX + e.delta.x;
      const y = ev.clientY + e.delta.y;
      const hit = rowAtPoint(x, y);
      if (!hit) return setIndicator(null);
      const rowId = hit.rowId;
      const zone: DropZone = rowId === "end" ? "inside" : zoneFor(hit.rect, y);
      const st = useEditor.getState();
      setIndicator({ rowId, zone, ok: resolveLayerDrop(st.project, st.pageId, id.slice(6), rowId, zone) !== null });
    },
    onDragEnd: () => setIndicator(null),
    onDragCancel: () => setIndicator(null),
  });

  return (
    <IndicatorCtx.Provider value={indicator}>
      <div role="tree" aria-label="Layers" style={{ padding: "8px 0" }}>
        {page.nodes.map((n, i) => <Row key={n.id} node={n} depth={0} parentId={page.id} index={i} siblings={page.nodes.length} />)}
        <EndZone indicator={indicator} />
        <p style={{ fontSize: 11, color: "#6b7280", padding: "4px 12px" }}>Drag ⠿ to reorder or nest: top edge = before, middle = inside, bottom edge = after. Keyboard: arrow keys move through the list; Alt + Up/Down reorders, Alt + Right nests into the item above, Alt + Left moves out. 👁 hides a layer.</p>
      </div>
    </IndicatorCtx.Provider>
  );
}
