"use client";
import { CROP_ASPECTS, cropRect, type CropAspect, type Node } from "@avc/schema";
import { useState } from "react";
import { syncAssets } from "../lib/cloud";
import { useEditor } from "../lib/store";

const btn: React.CSSProperties = { flex: 1, padding: "6px 4px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "8px 0 3px", display: "block" };

/**
 * Rotate and crop. These never touch the original: each creates a new file in the media library (marked as derived
 * from the original) and points the image at it, so "Back to original" is always available.
 * Brightness, contrast, blur, grayscale and masks are non-destructive parameters in the fields above.
 */
export function ImageTools({ node }: { node: Node }) {
  const { assets, deriveAsset, commit } = useEditor();
  const [aspect, setAspect] = useState<CropAspect | "original">("1:1");
  const [px, setPx] = useState(50);
  const [py, setPy] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetId = node.props.assetId as string | undefined;
  const asset = assets.find((a) => a.id === assetId);
  const original = asset?.derivedFrom ? assets.find((a) => a.id === asset.derivedFrom!.assetId) : undefined;

  const point = (id: string, summary: string) => commit({ summary, ops: [{ op: "update", id: node.id, props: { assetId: id, src: null } }] });
  const run = async (op: Parameters<typeof deriveAsset>[1], summary: string) => {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const next = await deriveAsset(asset.id, op);
      point(next.id, summary);
      void syncAssets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That edit failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!asset)
    return <p data-testid="image-tools" style={{ fontSize: 11, color: "#6b7280" }}>Rotate and crop work on files from your media library. Choose one above, or upload in the Media tab.</p>;

  const ratio = aspect === "original" ? null : CROP_ASPECTS[aspect];
  const rect = ratio ? cropRect(asset.width, asset.height, ratio, px / 100, py / 100) : null;
  const outW = rect ? Math.max(1, Math.round(rect.w * asset.width)) : asset.width;
  const outH = rect ? Math.max(1, Math.round(rect.h * asset.height)) : asset.height;

  return (
    <div data-testid="image-tools" style={{ borderTop: "1px solid #e5e7eb", marginTop: 12, paddingTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Rotate and crop</div>
      <div style={{ fontSize: 11, color: "#6b7280" }} data-testid="image-size">{asset.name} · {asset.width}×{asset.height}</div>

      <span style={lbl}>Rotate</span>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} disabled={busy} onClick={() => run({ rotate: 270 }, "Rotate left")}>⟲ Left</button>
        <button style={btn} disabled={busy} onClick={() => run({ rotate: 90 }, "Rotate right")}>⟳ Right</button>
        <button style={btn} disabled={busy} onClick={() => run({ rotate: 180 }, "Rotate 180")}>180°</button>
      </div>

      <span style={lbl}>Crop to</span>
      <select aria-label="Crop shape" style={{ ...btn, width: "100%", textAlign: "left" }} value={aspect} onChange={(e) => setAspect(e.target.value as CropAspect | "original")}>
        <option value="original">Original (no crop)</option>
        {(Object.keys(CROP_ASPECTS) as CropAspect[]).map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      {ratio && (
        <>
          <label style={lbl}>Position across <input aria-label="Crop position across" type="range" min={0} max={100} value={px} onChange={(e) => setPx(Number(e.target.value))} style={{ width: "100%" }} /></label>
          <label style={lbl}>Position down <input aria-label="Crop position down" type="range" min={0} max={100} value={py} onChange={(e) => setPy(Number(e.target.value))} style={{ width: "100%" }} /></label>
          <div style={{ fontSize: 11, color: "#6b7280" }} data-testid="crop-result">Result: {outW}×{outH}</div>
          <button style={{ ...btn, width: "100%", marginTop: 6, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} disabled={busy || !rect} onClick={() => rect && run({ crop: rect }, "Crop image")}>
            {busy ? "Working…" : "Apply crop"}
          </button>
        </>
      )}

      {original && (
        <button style={{ ...btn, width: "100%", marginTop: 8 }} onClick={() => point(original.id, "Back to original")}>↺ Back to original ({original.width}×{original.height})</button>
      )}
      {error && <div role="alert" style={{ marginTop: 6, color: "#b91c1c", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
