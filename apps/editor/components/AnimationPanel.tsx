"use client";
import { ANIMATIONS, animMeta, effectiveTrigger, getDef, type Animation } from "@avc/schema";
import { canvasHandle } from "../lib/canvasHandle";
import { findNode, useEditor } from "../lib/store";

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "12px 0 4px", display: "block" };
const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: 6, border: "1px solid #d1d5db", borderRadius: 4, background: on ? "#dbeafe" : "#fff", cursor: "pointer", fontSize: 12 });

/** Replays the selected element's animation inside the canvas (the editor otherwise keeps animations off). */
function play(nodeId: string, a: Animation) {
  const el = canvasHandle.iframe?.contentDocument?.querySelector(`[data-node="${nodeId}"]`);
  if (!el) return;
  el.classList.remove("avc-play");
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add("avc-play");
  const loops = animMeta(a.preset)?.group === "Attention" ? 6 : 1;
  setTimeout(() => el.classList.remove("avc-play"), (a.delayMs ?? 0) + (a.durationMs ?? 600) * loops + 150);
}

export function AnimationPanel() {
  const { project, selection, commit, project: { theme } } = useEditor();
  const found = selection ? findNode(project, selection) : null;
  const def = found ? getDef(found.node.type) : undefined;
  if (!found || !def) return <div style={{ padding: 12, fontSize: 13, color: "#6b7280" }}>Select an element on the canvas to animate it.</div>;
  if (!def.animatable) return <div style={{ padding: 12, fontSize: 13, color: "#6b7280" }}>{found.node.type} can't be animated.</div>;

  const node = found.node;
  const anim = node.animation;
  const set = (a: Animation | null) => commit({ summary: a ? "Edit animation" : "Remove animation", ops: [{ op: "update", id: node.id, animation: a }] });
  const choose = (preset: Animation["preset"]) => {
    const m = animMeta(preset)!;
    set({ preset, trigger: m.triggers[0], durationMs: anim?.durationMs ?? 600, delayMs: anim?.delayMs ?? 0 });
  };
  const meta = anim ? animMeta(anim.preset) : undefined;
  const num = (key: "durationMs" | "delayMs", min: number, max: number) => (v: string) => {
    const n = Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
    if (anim && n !== (anim[key] ?? (key === "durationMs" ? 600 : 0))) set({ ...anim, [key]: n });
  };

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>Animation · {node.type}</div>
      {theme.motion === "off" && (
        <div role="note" style={{ marginTop: 8, padding: 8, background: "#fffbeb", color: "#92400e", borderRadius: 4, fontSize: 12 }}>
          Theme motion is set to "off", so animations are disabled on the published site.
        </div>
      )}
      {(["Entrance", "Hover", "Attention", "Scroll"] as const).map((g) => (
        <div key={g}>
          <span style={label}>{g}</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            {ANIMATIONS.filter((a) => a.group === g && (!a.only || a.only.includes(node.type))).map((a) => (
              <button key={a.preset} data-testid={`anim-${a.preset}`} onClick={() => choose(a.preset)} style={seg(anim?.preset === a.preset)}>{a.label}</button>
            ))}
          </div>
        </div>
      ))}

      {anim && meta && (
        <>
          <span style={label}>Trigger</span>
          {meta.triggers.length > 1 ? (
            <div style={{ display: "flex", gap: 4 }}>
              {meta.triggers.map((t) => <button key={t} onClick={() => set({ ...anim, trigger: t })} style={seg(effectiveTrigger(anim) === t)}>{t === "scroll" ? "On scroll" : t === "load" ? "On load" : "On hover"}</button>)}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#6b7280" }}>{meta.group === "Scroll" ? "Moves as the visitor scrolls (speed and delay don't apply)" : meta.triggers[0] === "hover" ? "Plays on hover" : "Plays continuously"}</div>
          )}

          <span style={label}>Duration (ms)</span>
          <input key={"d" + anim.durationMs} aria-label="Duration" type="number" min={100} max={3000} step={50} defaultValue={anim.durationMs ?? 600}
            onBlur={(e) => num("durationMs", 100, 3000)(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} style={{ width: "100%", padding: 5, boxSizing: "border-box" }} />
          <span style={label}>Delay (ms)</span>
          <input key={"l" + anim.delayMs} aria-label="Delay" type="number" min={0} max={3000} step={50} defaultValue={anim.delayMs ?? 0}
            onBlur={(e) => num("delayMs", 0, 3000)(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} style={{ width: "100%", padding: 5, boxSizing: "border-box" }} />

          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            <button disabled={meta.group === "Hover" || meta.group === "Scroll"} title={meta.group === "Hover" ? "Hover over the element on the canvas" : meta.group === "Scroll" ? "Scroll the published page to see this" : ""} onClick={() => play(node.id, anim)} style={{ ...seg(false), flex: 1 }}>▶ Play</button>
            <button onClick={() => set(null)} style={{ ...seg(false), flex: 1, color: "#b91c1c" }}>Remove</button>
          </div>
          {meta.group === "Hover" && <p style={{ fontSize: 11, color: "#6b7280" }}>Hover over the element on the canvas to preview.</p>}
          <p style={{ fontSize: 11, color: "#6b7280" }}>Animations respect each visitor's "reduce motion" setting.</p>
        </>
      )}
    </div>
  );
}
