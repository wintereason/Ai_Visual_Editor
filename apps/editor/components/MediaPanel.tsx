"use client";
import { useRef, useState } from "react";
import { collectKeptAssetIds, type Asset } from "@avc/schema";
import { findNode, newId, useEditor } from "../lib/store";
import { deleteRemoteAsset, syncAssets, updateRemoteAssetAlt } from "../lib/cloud";

const fmt = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function MediaPanel() {
  const { assets, assetUrls, uploading, uploadErrors, addFiles, removeAsset, setAssetAlt, clearUploadErrors, project, pageId, selection, commit } = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const used = collectKeptAssetIds(project);
  const selected = selection ? findNode(project, selection)?.node : undefined;
  const target = selected?.type === "image" ? "image" : selected?.type === "hero" ? "hero" : selected?.type === "gallery" ? "gallery" : null;
  const total = assets.reduce((n, a) => n + a.bytes, 0);

  const upload = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length) void addFiles(list).then(() => syncAssets());
  };

  // Click a thumbnail: fill the selected image/hero, otherwise add a new image section at the end of the page.
  const use = (a: Asset) => {
    if (selected && target === "image") {
      commit({ summary: "Use media", ops: [{ op: "update", id: selected.id, props: { assetId: a.id, src: null, ...(a.alt ? { alt: a.alt } : {}) } }] });
    } else if (selected && target === "gallery") {
      const images = (selected.props.images as { assetId?: string; src?: string; alt: string }[]) ?? [];
      if (images.length >= 12) return useEditor.setState({ error: "A gallery can hold up to 12 images." });
      commit({ summary: "Add to gallery", ops: [{ op: "update", id: selected.id, props: { images: [...images, { assetId: a.id, alt: a.alt ?? "" }] } }] });
    } else if (selected && target === "hero") {
      commit({ summary: "Use media", ops: [{ op: "update", id: selected.id, props: { imageAssetId: a.id } }] });
    } else {
      const node = { id: newId(), kind: "element" as const, type: "image", props: { assetId: a.id, alt: a.alt ?? "", fit: "cover" } };
      const section = { id: newId(), kind: "container" as const, type: "section", props: {}, children: [node] };
      const page = project.pages.find((p) => p.id === pageId)!;
      commit({ summary: "Add image", ops: [{ op: "insert", parentId: pageId, index: page.nodes.length, node: section }] }, { select: node.id });
    }
  };
  const remove = (a: Asset) => {
    if (used.has(a.id) && !confirm(`"${a.name}" is used in this project. Deleting it will break those images until you replace them. Delete anyway?`)) return;
    // Remote first, so a concurrent sync can't download it back.
    void deleteRemoteAsset(a.id).then(() => removeAsset(a.id));
  };

  return (
    <div
      style={{ padding: 12, minHeight: 200, outline: over ? "2px dashed #2563eb" : "none", outlineOffset: -4 }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
    >
      <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload images" style={{ display: "none" }} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      <button onClick={() => input.current?.click()} disabled={uploading} style={{ width: "100%", padding: "8px 0", border: "1px solid #2563eb", borderRadius: 6, background: "#2563eb", color: "#fff", cursor: "pointer" }}>
        {uploading ? "Uploading…" : "⬆ Upload images"}
      </button>
      <p style={{ fontSize: 11, color: "#6b7280", margin: "6px 0" }}>
        PNG, JPEG, WebP or GIF, up to 20 MB. Drop files here. Photos are resized to 2400 px and location data is removed.
      </p>

      {uploadErrors.length > 0 && (
        <div role="alert" data-testid="upload-errors" style={{ padding: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 12, borderRadius: 4, marginBottom: 8 }}>
          {uploadErrors.map((e, i) => <div key={i}>{e}</div>)}
          <button onClick={clearUploadErrors} style={{ marginTop: 4, fontSize: 11 }}>Dismiss</button>
        </div>
      )}

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
        {assets.length} file{assets.length === 1 ? "" : "s"} · {fmt(total)}
        {target && <> · <b style={{ color: "#2563eb" }}>click to use in selected {target}</b></>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {assets.map((a) => (
          <div key={a.id} data-testid={`asset-${a.name}`} style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
            <button onClick={() => use(a)} title="Use this image" style={{ display: "block", width: "100%", padding: 0, border: 0, background: "#f3f4f6", cursor: "pointer" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrls[a.id]} alt={a.alt ?? a.name} style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }} />
            </button>
            <div style={{ padding: 4, fontSize: 11 }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.name}>{a.name}</div>
              <div style={{ color: "#6b7280" }}>{a.width}×{a.height} · {fmt(a.bytes)}{used.has(a.id) ? " · in use" : ""}</div>
              <input
                aria-label={`Alt text for ${a.name}`}
                placeholder="Alt text"
                defaultValue={a.alt ?? ""}
                onBlur={(e) => e.target.value !== (a.alt ?? "") && void setAssetAlt(a.id, e.target.value).then(() => updateRemoteAssetAlt(a.id, e.target.value))}
                style={{ width: "100%", boxSizing: "border-box", fontSize: 11, padding: 3, marginTop: 3, border: "1px solid #d1d5db", borderRadius: 3 }}
              />
              <button onClick={() => remove(a)} style={{ marginTop: 3, fontSize: 11, color: "#b91c1c", border: 0, background: "transparent", cursor: "pointer", padding: 0 }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {assets.length === 0 && <p style={{ fontSize: 12, color: "#6b7280" }}>No images yet.</p>}
    </div>
  );
}
