"use client";
import type { Node } from "@avc/schema";
import { newId, useEditor } from "../lib/store";

const box: React.CSSProperties = { borderTop: "1px solid #e5e7eb", marginTop: 16, paddingTop: 8 };
const small: React.CSSProperties = { padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };
const input: React.CSSProperties = { width: "100%", padding: "5px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };

/** Position, size, rotation and stacking order of one layer inside a layerGroup. Everything is a percentage of the group. */
export function LayerPosition({ node, parentId, index, count }: { node: Node; parentId: string; index: number; count: number }) {
  const commit = useEditor((s) => s.commit);
  const pl = node.place ?? { x: 10, y: 10, w: 40 };
  const set = (summary: string, place: Record<string, number>) => commit({ summary, ops: [{ op: "update", id: node.id, place }] as never });
  const move = (summary: string, to: number) => to !== index && to >= 0 && to < count && commit({ summary, ops: [{ op: "move", id: node.id, parentId, index: to }] });
  const num = (label: string, key: "x" | "y" | "w" | "r", min: number, max: number) => (
    <label style={{ fontSize: 11, color: "#6b7280" }}>
      {label}
      <input
        aria-label={`Layer ${label}`} key={`${key}:${pl[key] ?? 0}`} type="number" min={min} max={max} step={1} defaultValue={Math.round((pl[key] ?? 0) * 10) / 10} style={input}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (e.target.value === "" || !Number.isFinite(v)) { e.target.value = String(pl[key] ?? 0); return; }
          const clamped = Math.min(max, Math.max(min, v));
          if (clamped !== (pl[key] ?? 0)) set(`Layer ${label.toLowerCase()}`, { [key]: clamped });
          else e.target.value = String(clamped);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
  return (
    <div style={box} data-testid="layer-position">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Layer position</div>
        <button style={small} onClick={() => useEditor.getState().select(parentId)}>↑ Whole canvas</button>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", margin: "2px 0 6px" }}>As % of the canvas. You can also drag it, and drag its corner to resize.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {num("Left", "x", -50, 150)}{num("Top", "y", -50, 150)}{num("Width", "w", 1, 300)}{num("Rotate", "r", -180, 180)}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
        <button style={small} onClick={() => set("Center horizontally", { x: Math.round((50 - pl.w / 2) * 10) / 10 })}>Center ↔</button>
        <button style={small} onClick={() => set("Fill canvas", { x: 0, y: 0, w: 100, r: 0 })}>Fill canvas</button>
        <button style={small} onClick={() => set("Reset rotation", { r: 0 })}>Straighten</button>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10 }}>Stacking</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
        <button style={small} disabled={index >= count - 1} onClick={() => move("Bring to front", count - 1)}>To front</button>
        <button style={small} disabled={index >= count - 1} onClick={() => move("Bring forward", index + 1)}>Forward</button>
        <button style={small} disabled={index <= 0} onClick={() => move("Send backward", index - 1)}>Backward</button>
        <button style={small} disabled={index <= 0} onClick={() => move("Send to back", 0)}>To back</button>
      </div>
    </div>
  );
}

/** Adds layers to a layerGroup. */
export function LayerGroupTools({ node }: { node: Node }) {
  const { commit, assets, assetUrls } = useEditor();
  const count = node.children?.length ?? 0;
  const add = (summary: string, layer: Node) => commit({ summary, ops: [{ op: "insert", parentId: node.id, index: count, node: layer }] }, { select: layer.id });
  const el = (type: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({ id: newId(), kind: "element", type, props, ...extra });
  return (
    <div style={box} data-testid="layer-tools">
      <div style={{ fontSize: 12, fontWeight: 600 }}>Layers ({count})</div>
      <div style={{ fontSize: 11, color: "#6b7280", margin: "2px 0 6px" }}>Later layers sit on top. Reorder them in the Layers tab.</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button style={small} onClick={() => add("Add text layer", el("text", { text: "Your words" }, { place: { x: 10, y: 40, w: 60 } }))}>+ Text</button>
        <button style={small} onClick={() => add("Add heading layer", el("heading", { text: "Title", level: 2 }, { place: { x: 10, y: 10, w: 70 } }))}>+ Heading</button>
        <button style={small} onClick={() => add("Add shape layer", el("shape", { shape: "circle" }, { place: { x: 60, y: 10, w: 25 } }))}>+ Shape</button>
        <button style={small} onClick={() => add("Add icon layer", el("icon", { name: "star" }, { place: { x: 70, y: 60, w: 14 } }))}>+ Icon</button>
        <button style={small} onClick={() => add("Add picture layer", el("image", { src: "https://placehold.co/600x400", alt: "Placeholder image", fit: "cover" }, { place: { x: 5, y: 5, w: 50 } }))}>+ Picture</button>
      </div>
      {assets.length > 0 && (
        <select aria-label="Add a picture from media as a layer" value="" style={{ ...input, marginTop: 6 }}
          onChange={(e) => {
            const a = assets.find((x) => x.id === e.target.value);
            if (a) add("Add picture layer", el("image", { assetId: a.id, alt: a.alt ?? "", fit: "cover" }, { place: { x: 5, y: 5, w: 50 } }));
          }}>
          <option value="">+ Picture from Media…</option>
          {assets.filter((a) => assetUrls[a.id]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
    </div>
  );
}
