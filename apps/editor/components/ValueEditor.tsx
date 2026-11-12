"use client";
import type { Asset, FieldInfo } from "@avc/schema";
import { useState } from "react";

// Schema-driven editor for node props. Which fields exist, which are optional and what type each is all come from
// the same zod schema that validates the result (see describeProps), so the UI cannot drift from the rules.
// Blanking an optional field removes it (undefined); the parent turns that into a patch `null`.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const input: React.CSSProperties = { width: "100%", padding: "4px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
const iconBtn: React.CSSProperties = { border: 0, background: "transparent", cursor: "pointer", padding: "0 4px", fontSize: 13 };
const ASSET_KEYS = new Set(["assetId", "imageAssetId"]);
const LONG_KEYS = new Set(["body", "answer", "bio", "quote", "text", "subheadline"]);

type Common = { assets: Asset[]; path: string };

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 10, color: "#6b7280", display: "block", margin: "6px 0 2px" }}>{children}</span>;
}

/** One field, of any kind. `onChange(undefined)` means "remove this optional field". */
export function Field({ info, v, onChange, assets, path }: { info: FieldInfo; v: Json | undefined; onChange: (n: Json | undefined) => void } & Common) {
  const blank = (s: string): Json | undefined => (s === "" && info.optional ? undefined : s);

  if (info.kind === "array") {
    return (
      <div>
        <Label>{info.key}{info.optional ? " (optional)" : ""}</Label>
        <ArrayEditor name={path} value={Array.isArray(v) ? v : []} info={info} onChange={(n) => onChange(n)} assets={assets} />
      </div>
    );
  }
  if (info.kind === "object") {
    const obj = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as { [k: string]: Json };
    return (
      <div style={{ paddingLeft: 8, borderLeft: "2px solid #e5e7eb" }}>
        <Label>{info.key}</Label>
        {info.fields.map((f) => (
          <Field key={f.key} info={f} v={obj[f.key]} assets={assets} path={`${path} ${f.key}`}
            onChange={(n) => {
              const next = setKey(obj, f.key, n);
              // an optional group with nothing left in it is removed, rather than stored as {}
              onChange(Object.keys(next).length === 0 && info.optional ? undefined : next);
            }}
          />
        ))}
      </div>
    );
  }
  if (info.kind === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, margin: "6px 0 2px" }}>
        <input aria-label={path} type="checkbox" checked={v === true} onChange={(e) => onChange(e.target.checked)} /> {info.key}
      </label>
    );
  }
  if (info.kind === "enum") {
    return (
      <div>
        <Label>{info.key}</Label>
        <select aria-label={path} style={input} value={typeof v === "string" ? v : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}>
          {(info.optional || v === undefined) && <option value="">(default)</option>}
          {info.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (info.kind === "number") {
    return (
      <div>
        <Label>{info.key}</Label>
        <input
          aria-label={path} key={`${path}:${v ?? ""}`} type="number" defaultValue={typeof v === "number" ? v : ""} style={input}
          onBlur={(e) => {
            if (e.target.value === (v === undefined ? "" : String(v))) return;
            onChange(e.target.value === "" ? (info.optional ? undefined : 0) : Number(e.target.value));
          }}
        />
      </div>
    );
  }
  if (info.kind === "string" && ASSET_KEYS.has(info.key)) {
    // Pick from the media library instead of typing an id.
    const cur = typeof v === "string" ? v : "";
    const known = assets.some((a) => a.id === cur);
    return (
      <div>
        <Label>{info.key}</Label>
        <select aria-label={path} style={input} value={cur} onChange={(e) => onChange(blank(e.target.value))}>
          <option value="">(none)</option>
          {!known && cur && <option value={cur}>{cur} (not in library)</option>}
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
    );
  }
  if (info.kind === "string") {
    const s = typeof v === "string" ? v : "";
    const long = s.length > 60 || LONG_KEYS.has(info.key);
    const common = { "aria-label": path, key: `${path}:${s}`, defaultValue: s, style: { ...input, ...(long ? { minHeight: 56, resize: "vertical" as const } : {}) } };
    return (
      <div>
        <Label>{info.key}{info.optional ? " (optional)" : ""}</Label>
        {long ? (
          <textarea {...common} onBlur={(e) => e.target.value !== s && onChange(blank(e.target.value))} />
        ) : (
          <input {...common} onBlur={(e) => e.target.value !== s && onChange(blank(e.target.value))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        )}
      </div>
    );
  }
  return null;
}

/** Immutable object update where `undefined` deletes the key. */
function setKey(obj: { [k: string]: Json }, key: string, val: Json | undefined): { [k: string]: Json } {
  const next = { ...obj };
  if (val === undefined) delete next[key];
  else next[key] = val;
  return next;
}

export function ArrayEditor({ name, value, info, onChange, assets }: { name: string; value: Json[]; info: Extract<FieldInfo, { kind: "array" }>; onChange: (next: Json[]) => void; assets: Asset[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  const item = info.item;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  // A new item copies the last one, so it is valid straight away; the user edits from there.
  const add = () => onChange([...value, value.length ? structuredClone(value[value.length - 1]!) : ""]);
  const nested = name.includes(" ");

  return (
    <div data-testid={`list-${name}`} style={{ display: "grid", gap: 4 }}>
      {value.map((entry, i) => {
        const isObj = item.kind === "object";
        const title = isObj
          ? String(Object.values((entry ?? {}) as object).find((x) => typeof x === "string" && x && !String(x).startsWith("asset_")) ?? `Item ${i + 1}`).slice(0, 28)
          : String(entry ?? "").slice(0, 28) || `Item ${i + 1}`;
        return (
          <div key={i} data-testid={`${name}-item-${i}`} style={{ border: "1px solid #e5e7eb", borderRadius: 6, background: "#fafafa", padding: "2px 6px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {isObj && <button style={iconBtn} aria-label={`Toggle ${name} ${i + 1}`} onClick={() => setOpen({ ...open, [i]: !open[i] })}>{open[i] ? "▾" : "▸"}</button>}
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {title}</span>
              <button style={iconBtn} aria-label={`Move ${name} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button style={iconBtn} aria-label={`Move ${name} ${i + 1} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button style={{ ...iconBtn, color: "#b91c1c" }} aria-label={`Remove ${name} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
            </div>
            {isObj && item.kind === "object" ? (
              open[i] && (
                <div>
                  {item.fields.map((f) => (
                    <Field
                      key={f.key} info={f} assets={assets} path={`${name} ${i + 1} ${f.key}`}
                      v={((entry ?? {}) as { [k: string]: Json })[f.key]}
                      onChange={(n) => onChange(value.map((x, j) => (j === i ? setKey((x ?? {}) as { [k: string]: Json }, f.key, n) : x)))}
                    />
                  ))}
                </div>
              )
            ) : (
              <input aria-label={`${name} ${i + 1}`} key={`${i}:${String(entry)}`} defaultValue={String(entry ?? "")} style={input}
                onBlur={(e) => e.target.value !== String(entry ?? "") && onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            )}
          </div>
        );
      })}
      <button onClick={add} aria-label={`Add to ${name}`} style={{ ...iconBtn, border: "1px dashed #9ca3af", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "#374151" }}>+ Add {nested ? "line" : "item"}</button>
    </div>
  );
}
