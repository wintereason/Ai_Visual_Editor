"use client";
import { useDraggable } from "@dnd-kit/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderPage } from "@avc/renderer";
import { cloneWithNewIds, findNode, useEditor } from "../lib/store";
import { canvasHandle } from "../lib/canvasHandle";
import { LayerOverlay } from "./LayerOverlay";

// Logical viewport widths, so media queries match the device. The stage is scaled down to fit the available space.
const EDITABLE_PROP: Record<string, string> = { heading: "text", text: "text", link: "text", button: "label" };
const WIDTHS = { base: 1280, tablet: 820, mobile: 390 } as const;

const EDITOR_CSS = `
html{scroll-behavior:auto}
[data-anim]:not(.avc-play){animation:none!important}
[data-node]{cursor:default}
[data-node]:hover{outline:1px dashed #60a5fa;outline-offset:-1px}
.avc-sel{outline:2px solid #2563eb!important;outline-offset:-2px}
#avc-drop{position:absolute;background:#2563eb;border-radius:2px;pointer-events:none;z-index:99999;display:none}
/* :where() keeps the placeholder at zero specificity so any background or min-height the user sets always wins */
:where(section:empty, div[data-node]:empty:not([data-icon])){min-height:48px;background:repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 8px,#fff 8px,#fff 16px)}
`;

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="app"></style><style id="ed"></style></head><body><div id="root"></div><div id="avc-drop"></div></body></html>`;

type Rect = { left: number; top: number; width: number; height: number };

function MoveHandle({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `move:${id}` });
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} title="Drag to move" style={btn({ cursor: "grab" })}>
      ⠿
    </button>
  );
}
const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: "transparent", border: 0, color: "#fff", padding: "2px 6px", cursor: "pointer", fontSize: 13, ...extra,
});

export function Canvas({ dropLine, dragging }: { dropLine: Rect | null; dragging: boolean }) {
  const { project, pageId, selection, device, select, commit } = useEditor();
  const assetUrls = useEditor((s) => s.assetUrls);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [selRect, setSelRect] = useState<Rect | null>(null);
  const editingRef = useRef<HTMLElement | null>(null); // the element currently being edited in place, if any
  const [tick, setTick] = useState(0); // bumped when an edit ends so the canvas re-syncs with the project
  const boxRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 900, h: 700 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setAvail({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const phone = project.platform === "mobile"; // a mobile-only app is always shown as one phone screen
  const W = phone ? 390 : WIDTHS[device];
  const scale = Math.min(1, avail.w / W);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    const id = useEditor.getState().selection;
    const el = id && doc?.querySelector(`[data-node="${id}"]`);
    if (!el) return setSelRect(null);
    const r = el.getBoundingClientRect();
    setSelRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, []);

  function beginEdit(el: HTMLElement, id: string, type: string, key: string) {
    const original = el.textContent ?? "";
    const max = type === "button" ? 80 : 2000;
    editingRef.current = el;
    el.setAttribute("contenteditable", "true");
    el.style.outline = "2px solid #2563eb";
    el.style.cursor = "text";
    el.focus();
    const doc = el.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const sel = doc.defaultView!.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    let cancelled = false;

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancelled = true; el.blur(); }
    };
    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault(); // plain text only, so pasted rich content can't smuggle markup into the page
      doc.execCommand("insertText", false, ev.clipboardData?.getData("text/plain") ?? "");
    };
    const finish = () => {
      el.removeEventListener("blur", finish);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("paste", onPaste);
      el.removeAttribute("contenteditable");
      editingRef.current = null;
      const next = (el.textContent ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, max);
      if (!cancelled && next !== original) {
        useEditor.getState().commit({ summary: "Edit text", ops: [{ op: "update", id, props: { [key]: next } }] });
      }
      setTick((t) => t + 1); // re-render from the project: shows the committed text, or restores the original if rejected/cancelled
    };
    el.addEventListener("blur", finish);
    el.addEventListener("keydown", onKey);
    el.addEventListener("paste", onPaste);
  }

  const bound = useRef<Document | null>(null);
  const onLoad = useCallback(() => {
    const iframe = ref.current!;
    const doc = iframe.contentDocument;
    // Guard: onLoad can fire before hydration (missed) and again after; bind once per document.
    if (!doc || !doc.getElementById("root") || bound.current === doc) return;
    bound.current = doc;
    canvasHandle.iframe = iframe;
    doc.addEventListener("click", (e) => {
      // Clicks inside the text being edited must place the caret, not change the selection (which would re-render and drop the edit).
      if (editingRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      const el = (e.target as HTMLElement).closest?.("[data-node]");
      useEditor.getState().select(el ? el.getAttribute("data-node") : null);
    });
    // Double-click edits text in place (headings, text, links, buttons). Blocks are edited from the Inspector.
    doc.addEventListener("dblclick", (e) => {
      const el = (e.target as HTMLElement).closest?.("[data-node]") as HTMLElement | null;
      if (!el || editingRef.current) return;
      const id = el.getAttribute("data-node")!;
      const found = findNode(useEditor.getState().project, id);
      const key = found && EDITABLE_PROP[found.node.type];
      if (!key) return;
      e.preventDefault();
      useEditor.getState().select(id);
      beginEdit(el, id, found!.node.type, key);
    });
    // The iframe takes keyboard focus once you click the canvas, so shortcuts (undo, delete...) must be forwarded
    // to the editor. Never while typing inside an edited text.
    doc.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).isContentEditable) return;
      canvasHandle.onKey?.(e);
    });
    doc.addEventListener("submit", (e) => e.preventDefault());
    iframe.contentWindow!.addEventListener("scroll", measure);
    iframe.contentWindow!.addEventListener("resize", measure);
    setReady(true);
  }, [measure]);

  // SSR'd iframe may already be loaded before hydration; initialize on mount as well.
  useEffect(() => {
    onLoad();
    const t = setInterval(() => !bound.current && onLoad(), 100);
    return () => clearInterval(t);
  }, [onLoad]);

  // Re-render page into the iframe whenever the project changes.
  useLayoutEffect(() => {
    if (!ready || editingRef.current) return; // never replace the DOM under an active text edit
    const doc = ref.current!.contentDocument!;
    const { html, css } = renderPage(project, pageId, { assetUrl: (id) => assetUrls[id], editing: true });
    doc.getElementById("app")!.textContent = css;
    doc.getElementById("ed")!.textContent = EDITOR_CSS;
    doc.getElementById("root")!.innerHTML = html;
    doc.querySelectorAll(".avc-sel").forEach((e) => e.classList.remove("avc-sel"));
    if (selection) doc.querySelector(`[data-node="${selection}"]`)?.classList.add("avc-sel");
    measure();
  }, [project, pageId, selection, ready, device, measure, assetUrls, tick]);

  useEffect(() => {
    if (!ready) return;
    const doc = ref.current!.contentDocument!;
    const line = doc.getElementById("avc-drop")!;
    if (!dropLine) return void (line.style.display = "none");
    Object.assign(line.style, {
      display: "block", left: `${dropLine.left}px`, top: `${dropLine.top}px`,
      width: `${dropLine.width}px`, height: `${dropLine.height}px`,
    });
  }, [dropLine, ready]);

  const found = selection ? findNode(project, selection) : null;
  const siblingsCount = found
    ? found.parentId === pageId
      ? project.pages.find((p) => p.id === pageId)!.nodes.length
      : (findNode(project, found.parentId)?.node.children?.length ?? 0)
    : 0;

  const groupOf = found && found.parentId !== pageId ? findNode(project, found.parentId)?.node : undefined;
  const inLayerGroup = groupOf?.type === "layerGroup" && !!found?.node.place;

  const act = {
    up: () => found && found.index > 0 && commit({ summary: "Move up", ops: [{ op: "move", id: found.node.id, parentId: found.parentId, index: found.index - 1 }] }),
    down: () => found && found.index < siblingsCount - 1 && commit({ summary: "Move down", ops: [{ op: "move", id: found.node.id, parentId: found.parentId, index: found.index + 1 }] }),
    dup: () => {
      if (!found) return;
      const copy = cloneWithNewIds(found.node);
      commit({ summary: "Duplicate", ops: [{ op: "insert", parentId: found.parentId, index: found.index + 1, node: copy }] }, { select: copy.id });
    },
    del: () => found && commit({ summary: "Delete", ops: [{ op: "remove", id: found.node.id }] }, { select: null }),
  };

  return (
    <div ref={boxRef} style={{ height: "100%", width: "100%" }}>
    <div style={{ position: "relative", margin: "0 auto", width: W * scale, height: "100%" }}>
      <iframe ref={ref} srcDoc={SHELL} onLoad={onLoad} title="Canvas" style={{ position: "absolute", left: 0, top: 0, width: W, height: avail.h / scale, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, background: "#fff", boxShadow: phone ? "0 0 0 8px #1f2937, 0 10px 30px rgba(0,0,0,.3)" : "0 2px 12px rgba(0,0,0,.15)", borderRadius: phone ? 24 : 0 }} />
      {dragging && <div style={{ position: "absolute", inset: 0, zIndex: 20 }} />}
      {selRect && found && inLayerGroup && !editingRef.current && (
        <LayerOverlay key={found.node.id} nodeId={found.node.id} groupId={found.parentId} place={found.node.place!} rect={selRect} scale={scale} iframe={ref.current} />
      )}
      {selRect && found && (
        <div
          style={{
            position: "absolute", left: Math.max(selRect.left * scale, 0), top: Math.max(selRect.top * scale - 26, 0),
            background: "#2563eb", borderRadius: 4, display: "flex", alignItems: "center", gap: 2, padding: "0 4px", zIndex: 10,
          }}
        >
          <span style={{ color: "#fff", fontSize: 11, padding: "0 6px" }}>{found.node.type}</span>
          <MoveHandle id={found.node.id} />
          <button style={btn()} title="Move up" onClick={act.up}>↑</button>
          <button style={btn()} title="Move down" onClick={act.down}>↓</button>
          <button style={btn()} title="Duplicate" onClick={act.dup}>⧉</button>
          <button style={btn()} title="Delete" onClick={act.del}>🗑</button>
        </div>
      )}
    </div>
    </div>
  );
}
