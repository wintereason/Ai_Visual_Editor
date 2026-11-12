"use client";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { Palette } from "./Palette";
import { LayersPanel, resolveLayerDrop, rowAtPoint, zoneFor } from "./LayersPanel";
import { ThemePanel } from "./ThemePanel";
import { HistoryPanel } from "./HistoryPanel";
import { AnimationPanel } from "./AnimationPanel";
import { AIPanel } from "./AIPanel";
import { CreatePanel } from "./CreatePanel";
import { PagesPanel } from "./PagesPanel";
import { MediaPanel } from "./MediaPanel";
import { LeftRail, type LeftTab } from "./LeftRail";
import { ProjectSettings } from "./ProjectSettings";
import { TemplatesPanel } from "./TemplatesPanel";
import { ElementsPanel } from "./ElementsPanel";
import { TextPanel } from "./TextPanel";
import { BrandPanel } from "./BrandPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { ChartsPanel } from "./ChartsPanel";
import { ExportDialog } from "./ExportDialog";
import { CloudBanner, CloudControls } from "./CloudUI";
import { useCloud } from "../lib/cloud";
import { TemplateGallery } from "./TemplateGallery";
import { canvasHandle } from "../lib/canvasHandle";
import { resolveDrop, type DropTarget } from "../lib/drop";
import { LIBRARY, findDraggable } from "../lib/library";
import { announce, cloneWithNewIds, findNode, keyboardMove, useEditor } from "../lib/store";

function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div role="tablist" style={{ display: "flex", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, background: "inherit", zIndex: 1 }}>
      {items.map(([k, name]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          style={{ flex: 1, padding: "8px 4px", border: 0, borderBottom: value === k ? "2px solid #2563eb" : "2px solid transparent", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: value === k ? 600 : 400 }}>
          {name}
        </button>
      ))}
    </div>
  );
}

export function Editor() {
  const { project, pageId, past, future, device, setDevice, undo, redo, commit, select, selection, announcement } = useEditor();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [gallery, setGallery] = useState(false);
  const lastDrop = useRef<DropTarget | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("blocks");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // a mobile-only app is edited at its one (phone) size
  useEffect(() => { if (project.platform === "mobile" && device !== "base") setDevice("base"); }, [project.platform, device, setDevice]);
  const [rightTab, setRightTab] = useState<"style" | "animate" | "theme" | "history" | "ai">("style");
  const saveStatus = useEditor((s) => s.saveStatus);

  // Load saved project after mount (keeps SSR markup identical), then autosave on every project change.
  useEffect(() => {
    useEditor.getState().hydrate();
    void useCloud.getState().init();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.hydrated || s.project === prev.project) return;
      useEditor.setState({ saveStatus: "saving" });
      clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useEditor.getState();
        st.saveNow();
        void useCloud.getState().pushSync(); // no-op unless signed in and linked to a cloud project
        const last = st.versions[0];
        if (!last || Date.now() - last.at > 120_000) st.saveVersion("Autosave");
      }, 600);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  const resolve = useCallback((e: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const iframe = canvasHandle.iframe;
    const ev = e.activatorEvent as PointerEvent | undefined;
    if (!iframe?.contentDocument || !ev) return null;
    const rect = iframe.getBoundingClientRect();
    // The iframe is CSS-scaled to fit; convert pointer position into the iframe document's own coordinates.
    const scale = rect.width / iframe.clientWidth;
    const px = (ev.clientX + e.delta.x - rect.left) / scale;
    const py = (ev.clientY + e.delta.y - rect.top) / scale;
    if (px < 0 || py < 0 || px > iframe.clientWidth || py > iframe.clientHeight) return null;

    const id = String(e.active.id);
    if (id.startsWith("layer:")) return null; // layer drags are resolved against the Layers panel, not the canvas
    const { project, pageId } = useEditor.getState();
    let type: string;
    let movingId: string | undefined;
    if (id.startsWith("lib:")) type = findDraggable(id.slice(4))?.type ?? id.slice(4);
    else {
      movingId = id.slice(5);
      const f = findNode(project, movingId);
      if (!f) return null;
      type = f.node.type;
    }
    return resolveDrop(iframe.contentDocument, px, py, project, pageId, type, movingId);
  }, []);

  const onMove = (e: DragMoveEvent) => {
    const t = resolve(e);
    lastDrop.current = t;
    setDrop(t);
  };

  const onEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    if (activeId.startsWith("layer:")) {
      // Reorder / nest from the Layers panel. Same rules as the live indicator, so what you saw is what you get.
      setDrop(null);
      setDragLabel(null);
      lastDrop.current = null;
      const ev = e.activatorEvent as PointerEvent;
      const y = ev.clientY + e.delta.y;
      const hit = rowAtPoint(ev.clientX + e.delta.x, y);
      if (!hit) return;
      const rowId = hit.rowId;
      const zone = rowId === "end" ? "inside" : zoneFor(hit.rect, y);
      const st = useEditor.getState();
      const src = activeId.slice(6);
      const target = resolveLayerDrop(st.project, st.pageId, src, rowId, zone);
      const srcPos = findNode(st.project, src);
      const unchanged = !!target && !!srcPos && srcPos.parentId === target.parentId && srcPos.index === target.index;
      if (target && !unchanged) st.commit({ summary: "Move layer", ops: [{ op: "move", id: src, parentId: target.parentId, index: target.index }] }, { select: src });
      return;
    }
    const t = resolve(e) ?? lastDrop.current;
    setDrop(null);
    setDragLabel(null);
    lastDrop.current = null;
    if (!t) return;
    const id = String(e.active.id);
    const sectionDef = LIBRARY[0]!;

    if (id.startsWith("lib:")) {
      const item = findDraggable(id.slice(4))!;
      let node = item.make();
      const selectId = node.id;
      if (t.wrapInSection) {
        const s = sectionDef.make();
        s.children = [node];
        node = s;
      }
      commit({ summary: `Add ${item.label}`, ops: [{ op: "insert", parentId: t.parentId, index: t.index, node }] }, { select: selectId });
    } else {
      const moving = id.slice(5);
      if (t.wrapInSection) {
        const s = sectionDef.make();
        commit(
          { summary: "Move", ops: [{ op: "insert", parentId: t.parentId, index: t.index, node: s }, { op: "move", id: moving, parentId: s.id, index: 0 }] },
          { select: moving },
        );
      } else {
        commit({ summary: "Move", ops: [{ op: "move", id: moving, parentId: t.parentId, index: t.index }] }, { select: moving });
      }
    }
  };

  // Keyboard shortcuts. Registered for the page AND for the canvas iframe (which holds focus after you click it).
  //   Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Delete remove, Ctrl/Cmd+D duplicate,
  //   Alt+Up / Alt+Down move the selection within its parent (keyboard alternative to dragging), Esc deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      const st = useEditor.getState();
      const sel = st.selection;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); st.redo(); return; }
      if (key === "escape") { st.select(null); return; }
      if (!sel) return;
      const found = findNode(st.project, sel);
      if (!found) return;

      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        st.commit({ summary: "Delete", ops: [{ op: "remove", id: sel }] }, { select: null });
      } else if (mod && key === "d") {
        e.preventDefault(); // also stops the browser's "bookmark this page"
        const copy = cloneWithNewIds(found.node);
        st.commit({ summary: "Duplicate", ops: [{ op: "insert", parentId: found.parentId, index: found.index + 1, node: copy }] }, { select: copy.id });
      } else if (e.altKey && !mod && ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        // Keyboard move: Alt+Up/Down reorder, Alt+Right nests into the item above, Alt+Left moves out to the parent's level.
        // The same validator as a mouse drag decides; when it says no, the reason is announced rather than failing silently.
        e.preventDefault(); // (Alt+Left/Right are also the browser's Back/Forward)
        const dir = key === "arrowup" ? "up" : key === "arrowdown" ? "down" : key === "arrowright" ? "indent" : "outdent";
        keyboardMove(sel, dir);
      } else if (!mod && !e.altKey && found.node.place && ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key) && !t?.closest?.('[role="tree"]')) {
        // A photo layer can be nudged with the arrow keys (1% of the canvas; hold Shift for 10%).
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const clamp = (v: number) => Math.round(Math.min(150, Math.max(-50, v)) * 10) / 10;
        const p = found.node.place;
        const next = { x: clamp(p.x + (key === "arrowright" ? step : key === "arrowleft" ? -step : 0)), y: clamp(p.y + (key === "arrowdown" ? step : key === "arrowup" ? -step : 0)) };
        if (next.x === p.x && next.y === p.y) return announce("The layer is at the edge of its allowed range.");
        if (st.commit({ summary: "Nudge layer", ops: [{ op: "update", id: sel, place: next }] })) announce(`Layer at ${next.x}% from the left, ${next.y}% from the top.`);
      }
    };
    window.addEventListener("keydown", onKey);
    canvasHandle.onKey = onKey;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (canvasHandle.onKey === onKey) canvasHandle.onKey = undefined;
    };
  }, []);

  const tb: React.CSSProperties = { padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer" };

  return (
    <DndContext
      sensors={sensors}
      // The drag sensor is pointer-only, so the default screen-reader text ("press space to pick up") would be wrong. Say what really works.
      accessibility={{ screenReaderInstructions: { draggable: "Press Enter to add this to the page. Hold Shift while pressing Enter to add it next to the selected item. To move things precisely, select them in the Layers tab and use Alt with the arrow keys." } }}
      onDragStart={(e) => {
        // An overlay (not pointer-events:none on the iframe, which breaks elementsFromPoint) keeps pointer events in the parent doc.
        const aid = String(e.active.id);
        if (!aid.startsWith("layer:")) setDragging(true);
        setDragLabel(aid.startsWith("lib:") ? findDraggable(aid.slice(4))?.label ?? "" : aid.startsWith("layer:") ? "Move layer" : "Move");
      }}
      onDragMove={onMove}
      onDragEnd={(e) => { setDragging(false); onEnd(e); }}
      onDragCancel={() => { setDragging(false); setDrop(null); setDragLabel(null); }}
    >
      <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100vh" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
          <strong>{project.name}</strong>
          <span style={{ color: "#6b7280", fontSize: 13 }}>· {project.pages.find((p) => p.id === pageId)?.name}</span>
          <span style={{ flex: 1 }} />
          <span data-testid="save-status" style={{ fontSize: 12, color: saveStatus === "error" ? "#b91c1c" : "#6b7280" }}>
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : saveStatus === "error" ? "⚠ Not saved (storage unavailable)" : ""}
          </span>
          <button style={tb} disabled={!past.length} onClick={undo} title="Ctrl+Z">⟲ Undo</button>
          <button style={tb} disabled={!future.length} onClick={redo} title="Ctrl+Shift+Z">⟳ Redo</button>
          <CloudControls />
          <button style={tb} onClick={() => setGallery(true)}>New…</button>
          <button style={tb} onClick={() => setSettingsOpen(true)} title="Project type, app settings">⚙ Project</button>
          <button style={{ ...tb, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} onClick={() => setExporting(true)}>Export</button>
          <span style={{ width: 16 }} />
          {project.platform !== "mobile" && (["base", "tablet", "mobile"] as const).map((d) => (
            <button key={d} style={{ ...tb, background: device === d ? "#dbeafe" : "#fff" }} onClick={() => setDevice(d)}>
              {d === "base" ? "💻" : d === "tablet" ? "▭" : "📱"}
            </button>
          ))}
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "322px 1fr 280px", minHeight: 0 }}>
          <aside style={{ borderRight: "1px solid #e5e7eb", background: "#fafafa", display: "flex", minHeight: 0 }}>
            <LeftRail value={leftTab} onChange={setLeftTab} />
            <div data-testid="left-panel" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
              {leftTab === "templates" ? <TemplatesPanel onNewSite={() => setGallery(true)} /> : leftTab === "elements" ? <ElementsPanel /> : leftTab === "text" ? <TextPanel onAskAi={() => setLeftTab("create")} /> : leftTab === "brand" ? <BrandPanel /> : leftTab === "background" ? <BackgroundPanel /> : leftTab === "charts" ? <ChartsPanel /> : leftTab === "blocks" ? <Palette /> : leftTab === "layers" ? <LayersPanel /> : leftTab === "pages" ? <PagesPanel /> : leftTab === "create" ? <CreatePanel /> : <MediaPanel />}
            </div>
          </aside>
          <main style={{ background: "#e5e7eb", padding: 16, minHeight: 0, overflow: "hidden" }}><Canvas dropLine={drop?.line ?? null} dragging={dragging} /></main>
          <aside style={{ borderLeft: "1px solid #e5e7eb", background: "#fff", overflow: "auto" }}>
            <Tabs value={rightTab} onChange={setRightTab} items={[["style", "Style"], ["animate", "Animate"], ["theme", "Theme"], ["history", "History"], ["ai", "AI"]]} />
            {rightTab === "style" ? <Inspector /> : rightTab === "animate" ? <AnimationPanel /> : rightTab === "theme" ? <ThemePanel /> : rightTab === "history" ? <HistoryPanel /> : <AIPanel />}
          </aside>
        </div>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="a11y-live" style={{ position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}>{announcement}</div>
      <CloudBanner />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {gallery && <TemplateGallery onClose={() => setGallery(false)} />}
      {settingsOpen && <ProjectSettings onClose={() => setSettingsOpen(false)} />}
      <DragOverlay dropAnimation={null}>
        {dragLabel ? <div style={{ padding: "6px 12px", background: "#2563eb", color: "#fff", borderRadius: 6, fontSize: 13 }}>{dragLabel}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
