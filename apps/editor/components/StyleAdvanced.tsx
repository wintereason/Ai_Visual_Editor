"use client";
import { useRef, useState } from "react";
import type { StyleGroup, StyleProps } from "@avc/schema";

// Exact-value controls for every style property (spec 7.2 "Advanced controls").
// Every change is a patch through the parent's `setStyle`; the schema is the final judge of validity.

const TOKENS = ["none", "xs", "sm", "md", "lg", "xl", "2xl"];
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|theme\.[a-zA-Z]+)$/;
const THEME_COLORS = ["theme.primary", "theme.secondary", "theme.background", "theme.surface", "theme.text", "theme.muted"];

const inp: React.CSSProperties = { width: "100%", padding: "4px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
const bad: React.CSSProperties = { ...inp, borderColor: "#dc2626", background: "#fef2f2" };

type Props = {
  groups: ReadonlySet<StyleGroup>;
  current: StyleProps;
  setStyle: (patch: Record<string, unknown>) => void;
};

/** A labelled row with an "overridden here" dot and a reset button. */
function Row({ label, k, current, setStyle, children }: { label: string; k: keyof StyleProps; current: StyleProps; setStyle: Props["setStyle"]; children: React.ReactNode }) {
  const set = current[k] !== undefined;
  return (
    <div style={{ margin: "7px 0" }} data-testid={`adv-${String(k)}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
        <span style={{ flex: 1 }}>{label}</span>
        {set && <span title="Set at this device size / state" aria-label="overridden" style={{ color: "#2563eb" }}>●</span>}
        {set && <button aria-label={`Reset ${label}`} title="Reset" onClick={() => setStyle({ [k]: null })} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 12, padding: 0 }}>↺</button>}
      </div>
      {children}
    </div>
  );
}

/** Text input that takes a pixel number ("16") or a design token ("md"). Empty clears. Invalid input is flagged, never sent. */
function TokenInput({ value, onCommit, label }: { value: unknown; onCommit: (v: number | string | null) => void; label: string }) {
  const [invalid, setInvalid] = useState(false);
  const shown = value === undefined || value === null ? "" : String(value);
  return (
    <>
      <input
        key={shown} aria-label={label} list="avc-tokens" defaultValue={shown} placeholder="px or md"
        style={invalid ? bad : inp}
        onChange={() => setInvalid(false)}
        onBlur={(e) => {
          const t = e.target.value.trim();
          if (t === shown) return;
          if (t === "") return onCommit(null);
          if (/^-?\d+(\.\d+)?$/.test(t)) return onCommit(Number(t));
          if (TOKENS.includes(t)) return onCommit(t);
          setInvalid(true);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </>
  );
}

function NumInput({ value, onCommit, label, min, max, step }: { value: unknown; onCommit: (v: number | null) => void; label: string; min?: number; max?: number; step?: number }) {
  const shown = value === undefined || value === null ? "" : String(value);
  return (
    <input
      key={shown} aria-label={label} type="number" min={min} max={max} step={step} defaultValue={shown} style={inp}
      onBlur={(e) => {
        if (e.target.value === shown) return;
        onCommit(e.target.value === "" ? null : Number(e.target.value));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ColorInput({ value, onCommit, label }: { value: unknown; onCommit: (v: string | null) => void; label: string }) {
  const [invalid, setInvalid] = useState(false);
  const shown = typeof value === "string" ? value : "";
  const hex = /^#[0-9a-fA-F]{6}$/.test(shown) ? shown : "#000000";
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <input type="color" aria-label={`${label} picker`} value={hex} onChange={(e) => onCommit(e.target.value)} style={{ width: 30, height: 26, padding: 0, flex: "none" }} />
      <input
        key={shown} aria-label={label} list="avc-theme-colors" defaultValue={shown} placeholder="#hex or theme.primary" style={invalid ? bad : inp}
        onChange={() => setInvalid(false)}
        onBlur={(e) => {
          const t = e.target.value.trim();
          if (t === shown) return;
          if (t === "") return onCommit(null);
          if (COLOR_RE.test(t)) return onCommit(t);
          setInvalid(true);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

function Select<T extends string>({ value, options, onCommit, label }: { value: unknown; options: readonly T[]; onCommit: (v: T | null) => void; label: string }) {
  return (
    <select aria-label={label} value={typeof value === "string" ? value : ""} style={inp} onChange={(e) => onCommit((e.target.value || null) as T | null)}>
      <option value="">(inherit)</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** number + unit, e.g. width 60 % */
function UnitInput({ value, units, onCommit, label, extra }: { value: unknown; units: readonly string[]; onCommit: (v: unknown) => void; label: string; extra?: readonly string[] }) {
  const v = value && typeof value === "object" ? (value as { value: number; unit: string }) : null;
  const keyword = typeof value === "string" ? value : "";
  const numRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <input
        ref={numRef} key={`${v?.value ?? ""}${keyword}`} aria-label={label} type="number" defaultValue={v?.value ?? ""} placeholder={keyword || "auto"} style={{ ...inp, flex: 2 }}
        onBlur={(e) => {
          if (e.target.value === "") return keyword || v ? onCommit(null) : undefined;
          if (Number(e.target.value) === v?.value) return;
          onCommit({ value: Number(e.target.value), unit: v?.unit ?? units[0] });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <select
        aria-label={`${label} unit`} value={v?.unit ?? keyword} style={{ ...inp, flex: 1 }}
        onChange={(e) => {
          if (extra?.includes(e.target.value)) return onCommit(e.target.value);
          // Use what is typed right now, even if the number field has not blurred yet.
          const typed = numRef.current?.value ?? "";
          onCommit({ value: typed !== "" ? Number(typed) : (v?.value ?? 100), unit: e.target.value });
        }}
      >
        {!v && !keyword && <option value="">—</option>}
        {(extra ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
        {units.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
}

function Four({ label, k, names, current, setStyle }: { label: string; k: "padding" | "margin" | "radius"; names: [string, string][]; current: StyleProps; setStyle: Props["setStyle"] }) {
  const obj = (current[k] ?? {}) as Record<string, unknown>;
  return (
    <Row label={label} k={k} current={current} setStyle={setStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {names.map(([side, short]) => (
          <label key={side} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6b7280" }}>
            {short}
            <TokenInput label={`${label} ${side}`} value={obj[side]} onCommit={(v) => setStyle({ [k]: { [side]: v } })} />
          </label>
        ))}
      </div>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 6, marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#374151" }}>{title}</div>
      {children}
    </div>
  );
}

export function StyleAdvanced({ groups, current, setStyle }: Props) {
  const R = (label: string, k: keyof StyleProps, children: React.ReactNode) => (
    <Row label={label} k={k} current={current} setStyle={setStyle}>{children}</Row>
  );
  const sides: [string, string][] = [["top", "T"], ["right", "R"], ["bottom", "B"], ["left", "L"]];
  const corners: [string, string][] = [["tl", "TL"], ["tr", "TR"], ["br", "BR"], ["bl", "BL"]];
  const grad = current.background && typeof current.background === "object" && "stops" in current.background ? current.background : null;
  const setGrad = (g: { angle?: number; a?: string; b?: string }) =>
    setStyle({ background: { type: "linear", angle: g.angle ?? grad?.angle ?? 135, stops: [{ color: g.a ?? grad?.stops[0]?.color ?? "theme.primary", at: 0 }, { color: g.b ?? grad?.stops[1]?.color ?? "theme.secondary", at: 100 }] } });

  return (
    <div>
      <datalist id="avc-tokens">{TOKENS.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="avc-theme-colors">{THEME_COLORS.map((t) => <option key={t} value={t} />)}</datalist>

      {groups.has("layout") && (
        <Section title="Layout">
          {R("Display", "display", <Select label="Display" value={current.display} options={["block", "flex", "grid"] as const} onCommit={(v) => setStyle({ display: v })} />)}
          {R("Direction", "direction", <Select label="Direction" value={current.direction} options={["row", "column"] as const} onCommit={(v) => setStyle({ direction: v })} />)}
          {R("Gap", "gap", <TokenInput label="Gap" value={current.gap} onCommit={(v) => setStyle({ gap: v })} />)}
          {R("Align", "align", <Select label="Align" value={current.align} options={["start", "center", "end", "stretch"] as const} onCommit={(v) => setStyle({ align: v })} />)}
          {R("Justify", "justify", <Select label="Justify" value={current.justify} options={["start", "center", "end", "between"] as const} onCommit={(v) => setStyle({ justify: v })} />)}
          {R("Grid columns", "columns", <NumInput label="Grid columns" min={1} max={6} value={current.columns} onCommit={(v) => setStyle({ columns: v })} />)}
          {R("Wrap", "wrap", <Select label="Wrap" value={current.wrap === undefined ? "" : String(current.wrap)} options={["true", "false"] as const} onCommit={(v) => setStyle({ wrap: v === null ? null : v === "true" })} />)}
        </Section>
      )}

      {groups.has("size") && (
        <Section title="Size">
          {R("Width", "width", <UnitInput label="Width" value={current.width} units={["px", "%", "rem"]} extra={["auto", "fill"]} onCommit={(v) => setStyle({ width: v })} />)}
          {R("Max width", "maxWidth", <UnitInput label="Max width" value={current.maxWidth} units={["px", "%", "rem"]} onCommit={(v) => setStyle({ maxWidth: v })} />)}
          {R("Min height", "minHeight", <UnitInput label="Min height" value={current.minHeight} units={["px", "vh", "rem"]} onCommit={(v) => setStyle({ minHeight: v })} />)}
          {R("Aspect ratio", "aspectRatio", (
            <input aria-label="Aspect ratio" key={current.aspectRatio ?? ""} defaultValue={current.aspectRatio ?? ""} placeholder="16 / 9" style={inp}
              onBlur={(e) => e.target.value !== (current.aspectRatio ?? "") && setStyle({ aspectRatio: e.target.value.trim() || null })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          ))}
        </Section>
      )}

      {groups.has("spacing") && (
        <Section title="Spacing">
          <Four label="Padding" k="padding" names={sides} current={current} setStyle={setStyle} />
          <Four label="Margin" k="margin" names={sides} current={current} setStyle={setStyle} />
        </Section>
      )}

      {groups.has("background") && (
        <Section title="Background">
          {R("Color", "background", <ColorInput label="Background color" value={typeof current.background === "string" ? current.background : ""} onCommit={(v) => setStyle({ background: v })} />)}
          <div style={{ fontSize: 11, color: "#6b7280", margin: "4px 0" }}>Gradient {grad ? "(active)" : ""}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
            <ColorInput label="Gradient from" value={grad?.stops[0]?.color ?? ""} onCommit={(v) => v && setGrad({ a: v })} />
            <ColorInput label="Gradient to" value={grad?.stops[1]?.color ?? ""} onCommit={(v) => v && setGrad({ b: v })} />
            <NumInput label="Gradient angle" min={0} max={360} value={grad?.angle} onCommit={(v) => v !== null && setGrad({ angle: v })} />
            {!grad && <button style={{ ...inp, cursor: "pointer" }} onClick={() => setGrad({})}>Use a gradient</button>}
          </div>
        </Section>
      )}

      {groups.has("border") && (
        <Section title="Border">
          {R("Border", "border", (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <NumInput label="Border width" min={0} max={32} value={current.border?.width} onCommit={(v) => v !== null && setStyle({ border: { width: v, style: current.border?.style ?? "solid", color: current.border?.color ?? "theme.text" } })} />
              <Select label="Border style" value={current.border?.style} options={["solid", "dashed"] as const} onCommit={(v) => v && setStyle({ border: { width: current.border?.width ?? 1, style: v, color: current.border?.color ?? "theme.text" } })} />
              <div style={{ gridColumn: "1 / -1" }}>
                <ColorInput label="Border color" value={current.border?.color} onCommit={(v) => v && setStyle({ border: { width: current.border?.width ?? 1, style: current.border?.style ?? "solid", color: v } })} />
              </div>
            </div>
          ))}
          <Four label="Radius" k="radius" names={corners} current={current} setStyle={setStyle} />
        </Section>
      )}

      {groups.has("effects") && (
        <Section title="Effects">
          {R("Shadow", "shadow", <Select label="Shadow" value={current.shadow} options={["none", "sm", "md", "lg"] as const} onCommit={(v) => setStyle({ shadow: v })} />)}
          {R("Opacity", "opacity", <NumInput label="Opacity" min={0} max={1} step={0.05} value={current.opacity} onCommit={(v) => setStyle({ opacity: v })} />)}
          {R("Backdrop blur (px)", "backdropBlur", <NumInput label="Backdrop blur" min={0} max={40} value={current.backdropBlur} onCommit={(v) => setStyle({ backdropBlur: v })} />)}
        </Section>
      )}

      {groups.has("typography") && (
        <Section title="Typography">
          {R("Font", "fontFamily", <Select label="Font" value={current.fontFamily} options={["heading", "body"] as const} onCommit={(v) => setStyle({ fontFamily: v })} />)}
          {R("Size", "fontSize", <TokenInput label="Font size" value={current.fontSize} onCommit={(v) => setStyle({ fontSize: v })} />)}
          {R("Weight", "fontWeight", <Select label="Font weight" value={current.fontWeight === undefined ? "" : String(current.fontWeight)} options={["300", "400", "500", "600", "700", "800"] as const} onCommit={(v) => setStyle({ fontWeight: v === null ? null : Number(v) })} />)}
          {R("Line height", "lineHeight", <NumInput label="Line height" min={0.8} max={3} step={0.1} value={current.lineHeight} onCommit={(v) => setStyle({ lineHeight: v })} />)}
          {R("Letter spacing (px)", "letterSpacing", <NumInput label="Letter spacing" min={-5} max={20} step={0.5} value={current.letterSpacing} onCommit={(v) => setStyle({ letterSpacing: v })} />)}
          {R("Align", "textAlign", <Select label="Text align" value={current.textAlign} options={["left", "center", "right"] as const} onCommit={(v) => setStyle({ textAlign: v })} />)}
          {R("Text color", "color", <ColorInput label="Text color" value={current.color} onCommit={(v) => setStyle({ color: v })} />)}
        </Section>
      )}

      {groups.has("position") && (
        <Section title="Position">
          {R("Position", "position", <Select label="Position" value={current.position} options={["static", "sticky", "fixed"] as const} onCommit={(v) => setStyle({ position: v })} />)}
        </Section>
      )}
    </div>
  );
}
