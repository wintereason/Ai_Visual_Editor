"use client";
import { failingPairs } from "../lib/contrast";
import { useEditor } from "../lib/store";

const FONTS = ["Poppins", "Inter", "Roboto", "Montserrat", "Lora", "Georgia", "system-ui"];
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "12px 0 4px", display: "block" };
const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: 6, border: "1px solid #d1d5db", borderRadius: 4, background: on ? "#dbeafe" : "#fff", cursor: "pointer", fontSize: 12 });

export function ThemePanel() {
  const { project, commit } = useEditor();
  const t = project.theme;
  const set = (theme: object) => commit({ summary: "Edit theme", ops: [{ op: "setTheme", theme }] as any });
  const bad = failingPairs(t.colors);

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>Theme</div>
      <span style={label}>Colors</span>
      {(Object.keys(t.colors) as (keyof typeof t.colors)[]).map((k) => (
        <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <input type="color" aria-label={k} value={/^#[0-9a-f]{6}$/i.test(t.colors[k]) ? t.colors[k] : "#000000"} onChange={(e) => set({ colors: { [k]: e.target.value } })} />
          <span style={{ flex: 1, textTransform: "capitalize" }}>{k}</span>
          <code style={{ fontSize: 11, color: "#6b7280" }}>{t.colors[k]}</code>
        </label>
      ))}
      {bad.length > 0 && (
        <div role="note" style={{ marginTop: 8, padding: 8, background: "#fffbeb", color: "#92400e", borderRadius: 4, fontSize: 12 }}>
          ⚠ {bad.length} color pair{bad.length > 1 ? "s" : ""} fail contrast (WCAG AA 4.5:1)
          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
            {bad.map((b) => <li key={b.label}>{b.label}: {b.ratio.toFixed(1)}:1</li>)}
          </ul>
        </div>
      )}

      <span style={label}>Fonts</span>
      {(["heading", "body"] as const).map((k) => (
        <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ width: 60, textTransform: "capitalize" }}>{k}</span>
          <select value={t.fonts[k]} onChange={(e) => set({ fonts: { [k]: e.target.value } })} style={{ flex: 1, padding: 4 }}>
            {[...new Set([t.fonts[k], ...FONTS])].map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
      ))}

      <span style={label}>Corners</span>
      <div style={{ display: "flex", gap: 4 }}>
        {(["none", "sm", "md", "lg", "full"] as const).map((r) => <button key={r} style={seg(t.radius === r)} onClick={() => set({ radius: r })}>{r}</button>)}
      </div>
      <span style={label}>Motion</span>
      <div style={{ display: "flex", gap: 4 }}>
        {(["off", "subtle", "full"] as const).map((m) => <button key={m} style={seg(t.motion === m)} onClick={() => set({ motion: m })}>{m}</button>)}
      </div>
    </div>
  );
}
