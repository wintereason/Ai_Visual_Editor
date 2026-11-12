"use client";
import { useRef, useState } from "react";
import { useEditor } from "../lib/store";

type Rect = { left: number; top: number; width: number; height: number };
type Place = { x: number; y: number; w: number; r?: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Drag a layer to move it, drag its corner to resize it. While dragging, the layer's box in the canvas is updated directly (cheap and smooth);
 * letting go commits ONE undoable change. Positions are stored as percentages of the layer group, so they survive any screen size.
 */
export function LayerOverlay({ nodeId, groupId, place, rect, scale, iframe }: { nodeId: string; groupId: string; place: Place; rect: Rect; scale: number; iframe: HTMLIFrameElement | null }) {
  const commit = useEditor((s) => s.commit);
  const [live, setLive] = useState<Rect | null>(null);
  const drag = useRef<{ mode: "move" | "size"; sx: number; sy: number; start: Place; gw: number; gh: number; moved: boolean; last: Place } | null>(null);

  const wrapper = () => iframe?.contentDocument?.querySelector(`[data-layer="${nodeId}"]`) as HTMLElement | null;

  const begin = (mode: "move" | "size") => (e: React.PointerEvent) => {
    const doc = iframe?.contentDocument;
    const g = doc?.querySelector(`[data-node="${groupId}"]`)?.getBoundingClientRect();
    if (!g || !g.width || !g.height || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: place, gw: g.width, gh: g.height, moved: false, last: place };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale; // parent pixels -> canvas pixels
    if (!d.moved && Math.hypot(dx, dy) < 3) return; // a click, not a drag
    d.moved = true;
    const next: Place = d.mode === "move"
      ? { ...d.start, x: r1(clamp(d.start.x + (dx / d.gw) * 100, -50, 150)), y: r1(clamp(d.start.y + (dy / d.gh) * 100, -50, 150)) }
      : { ...d.start, w: r1(clamp(d.start.w + (dx / d.gw) * 100, 1, 300)) };
    d.last = next;
    const w = wrapper();
    if (w) { w.style.left = `${next.x}%`; w.style.top = `${next.y}%`; w.style.width = `${next.w}%`; }
    // follow with the selection box
    const dxp = ((next.x - d.start.x) / 100) * d.gw * scale, dyp = ((next.y - d.start.y) / 100) * d.gh * scale;
    const dwp = ((next.w - d.start.w) / 100) * d.gw * scale;
    setLive({ left: rect.left * scale + dxp, top: rect.top * scale + dyp, width: rect.width * scale + dwp, height: rect.height * scale * (d.mode === "size" ? next.w / d.start.w : 1) });
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    setLive(null);
    if (!d?.moved) return;
    const changed = d.mode === "move" ? { x: d.last.x, y: d.last.y } : { w: d.last.w };
    commit({ summary: d.mode === "move" ? "Move layer" : "Resize layer", ops: [{ op: "update", id: nodeId, place: changed }] as never });
  };

  const box = live ?? { left: rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale };
  return (
    <div
      data-testid="layer-overlay"
      onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => iframe?.contentDocument?.querySelector(`[data-node="${nodeId}"]`)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))}
      style={{ position: "absolute", left: box.left, top: box.top, width: Math.max(box.width, 8), height: Math.max(box.height, 8), cursor: "move", zIndex: 9, touchAction: "none", outline: "1px solid rgba(37,99,235,.0)" }}
    >
      <div
        data-testid="layer-resize" title="Drag to resize"
        onPointerDown={begin("size")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        style={{ position: "absolute", right: -7, bottom: -7, width: 14, height: 14, background: "#fff", border: "2px solid #2563eb", borderRadius: 3, cursor: "nwse-resize", touchAction: "none" }}
      />
    </div>
  );
}
