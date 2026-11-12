"use client";
import { useState } from "react";
import { describeProps, getDef, type StyleProps } from "@avc/schema";
import { findNode, useEditor } from "../lib/store";
import { StyleAdvanced } from "./StyleAdvanced";
import { Field, type Json } from "./ValueEditor";
import { ImageTools } from "./ImageTools";
import { LayerGroupTools, LayerPosition } from "./LayerTools";

const PAD: Record<string, string> = { none: "None", sm: "S", md: "M", lg: "L", xl: "XL" };

const field: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, boxSizing: "border-box" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "10px 0 4px", display: "block" };

export function Inspector() {
  const { project, selection, device, commit, error, clearError } = useEditor();
  const assets = useEditor((st) => st.assets);
  const [state, setState] = useState<"normal" | "hover">("normal");
  const found = selection ? findNode(project, selection) : null;
  const def = found ? getDef(found.node.type) : undefined;

  if (!found || !def) return <div style={{ padding: 12, fontSize: 13, color: "#6b7280" }}>Select an element on the canvas.</div>;
  const node = found.node;
  const parentNode = findNode(project, found.parentId)?.node;
  const fields = describeProps(node.type);
  const groups = new Set(def.styleGroups);
  const current: StyleProps = node.styles?.[device]?.[state] ?? {};

  const setProp = (key: string, value: unknown) =>
    commit({ summary: `Edit ${key}`, ops: [{ op: "update", id: node.id, props: { [key]: value } }] });
  const setStyle = (patch: Record<string, unknown>) =>
    commit({ summary: "Edit style", ops: [{ op: "update", id: node.id, styles: { [device]: { [state]: patch } } }] });

  const padVal = typeof current.padding?.top === "string" ? current.padding.top : "";
  const bg = typeof current.background === "string" ? current.background : "";

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{node.type}</div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>id: {node.id}</div>

      {def.variants && (
        <>
          <span style={label}>Variant</span>
          <select style={field} value={node.variant ?? ""} onChange={(e) => commit({ summary: "Change variant", ops: [{ op: "update", id: node.id, variant: e.target.value }] })}>
            {def.variants.map((v) => <option key={v}>{v}</option>)}
          </select>
        </>
      )}

      {/* Every prop the schema knows about is offered, set or not; blanking an optional one removes it. */}
      {fields.map((info) => (
        <div key={info.key}>
          <Field
            info={info} v={node.props[info.key] as Json | undefined} assets={assets} path={info.key}
            onChange={(n) => setProp(info.key, n === undefined ? null : n)}
          />
          {info.kind === "array" && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: "#6b7280" }}>Edit as JSON</summary>
              <textarea
                key={node.id + info.key + JSON.stringify(node.props[info.key])}
                aria-label={`${info.key} JSON`}
                style={{ ...field, fontFamily: "monospace", minHeight: 80, marginTop: 4 }}
                defaultValue={JSON.stringify(node.props[info.key] ?? [], null, 1)}
                onBlur={(e) => {
                  try { setProp(info.key, JSON.parse(e.target.value)); } catch { useEditor.setState({ error: `${info.key}: invalid JSON` }); }
                }}
              />
            </details>
          )}
        </div>
      ))}

      {node.type === "image" && <ImageTools node={node} />}
      {node.type === "layerGroup" && <LayerGroupTools node={node} />}
      {parentNode?.type === "layerGroup" && <LayerPosition node={node} parentId={found.parentId} index={found.index} count={parentNode.children?.length ?? 0} />}

      <div style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0 4px" }} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>Style · {device === "base" ? "Desktop" : device}</div>
      <div role="group" aria-label="State" style={{ display: "flex", gap: 4, margin: "6px 0" }}>
        {(["normal", "hover"] as const).map((st) => (
          <button key={st} aria-pressed={state === st} onClick={() => setState(st)}
            style={{ flex: 1, padding: 5, border: "1px solid #d1d5db", borderRadius: 4, background: state === st ? "#dbeafe" : "#fff", cursor: "pointer", fontSize: 12, textTransform: "capitalize" }}>{st}</button>
        ))}
      </div>
      {state === "hover" && <div style={{ fontSize: 11, color: "#6b7280" }}>Hover styles are layered on top of Normal.</div>}

      {groups.has("spacing") && (
        <>
          <span style={label}>Padding</span>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.entries(PAD).map(([k, name]) => (
              <button key={k} onClick={() => setStyle({ padding: { top: k, right: k, bottom: k, left: k } })}
                style={{ flex: 1, padding: 6, border: "1px solid #d1d5db", borderRadius: 4, background: padVal === k ? "#dbeafe" : "#fff", cursor: "pointer" }}>{name}</button>
            ))}
            <button title="Reset" onClick={() => setStyle({ padding: null })} style={{ padding: 6, border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer" }}>↺</button>
          </div>
        </>
      )}
      {groups.has("background") && (
        <>
          <span style={label}>Background</span>
          <div style={{ display: "flex", gap: 4 }}>
            <input type="color" value={bg.startsWith("#") && bg.length === 7 ? bg : "#ffffff"} onChange={(e) => setStyle({ background: e.target.value })} />
            <button onClick={() => setStyle({ background: "theme.surface" })} style={{ flex: 1 }}>Surface</button>
            <button onClick={() => setStyle({ background: "theme.primary" })} style={{ flex: 1 }}>Primary</button>
            <button onClick={() => setStyle({ background: null })}>↺</button>
          </div>
        </>
      )}
      {groups.has("typography") && (
        <>
          <span style={label}>Text align</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} onClick={() => setStyle({ textAlign: a })} style={{ flex: 1, padding: 6, border: "1px solid #d1d5db", borderRadius: 4, background: current.textAlign === a ? "#dbeafe" : "#fff", cursor: "pointer" }}>{a}</button>
            ))}
          </div>
        </>
      )}
      {groups.has("visibility") && (
        <label style={{ display: "block", marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={!!current.hidden} onChange={(e) => setStyle({ hidden: e.target.checked ? true : null })} /> Hide on {device === "base" ? "desktop" : device}
        </label>
      )}

      <details style={{ marginTop: 12 }} data-testid="advanced">
        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Advanced</summary>
        <StyleAdvanced groups={groups} current={current} setStyle={setStyle} />
      </details>

      {error && (
        <div role="alert" style={{ marginTop: 16, padding: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 12, borderRadius: 4 }}>
          {error} <button onClick={clearError} style={{ marginLeft: 6 }}>×</button>
        </div>
      )}
    </div>
  );
}
