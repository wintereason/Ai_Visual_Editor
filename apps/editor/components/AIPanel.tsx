"use client";
import { useRef, useState } from "react";
import { askAi, newRequestKey, onlyPage, progressText, type AiProgress, type PatchResponse } from "../lib/ai";
import { useCloud } from "../lib/cloud";
import { findNode, useEditor } from "../lib/store";

const MAX = 1000;
const SUGGESTIONS = ["Make it bolder", "Add a subtle animation", "Simplify the text", "Translate to Hindi"];

type Done = { summary: string; changed: number; cost: number; undoAt: number | null };

export function AIPanel() {
  const { project, pageId, selection, commit, undo } = useEditor();
  const pastLength = useEditor((st) => st.past.length); // subscribes, so Undo disappears as soon as anything else changes
  const { available, user } = useCloud();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const node = selection ? findNode(project, selection)?.node : undefined;
  const signedIn = available && !!user;
  const trimmed = text.trim();
  const can = !!node && signedIn && trimmed.length > 0 && trimmed.length <= MAX && !busy;

  const send = async () => {
    if (!can || !node) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setProgress(null);
    ctl.current = new AbortController();
    const result = await askAi<PatchResponse>("patch", { project: onlyPage(project, pageId), nodeId: node.id, instruction: trimmed, idempotencyKey: newRequestKey() }, ctl.current.signal, setProgress);
    setBusy(false);
    setProgress(null);
    if (!result.ok) {
      if (result.code !== "cancelled") setError(result.message);
      return;
    }
    // The server's patch is untrusted input: it goes through the same write path as every other change, limited to the
    // selected node, and is rejected here if it would not be safe, whatever the server said.
    const before = useEditor.getState().past.length;
    const applied = commit(result.data.patch, { scope: node.id, select: node.id });
    if (!applied) {
      useEditor.getState().clearError();
      setError("I couldn't apply that change safely. Nothing was changed. Try rephrasing, or edit it manually.");
      return;
    }
    setDone({ summary: result.data.summary, changed: result.data.touched.length, cost: result.credits?.cost ?? 0, undoAt: before + 1 });
  };

  const cancel = () => ctl.current?.abort();
  // "Undo" only while the AI change is still the latest one; otherwise it would undo something else.
  const canUndo = done != null && done.undoAt === pastLength;

  const box: React.CSSProperties = { padding: 12, fontSize: 13 };
  const btn: React.CSSProperties = { padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };

  return (
    <div style={box} data-testid="ai-panel">
      <div style={{ fontWeight: 600 }}>✦ Ask AI</div>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 8px" }}>
        {node ? <>Changes only the selected <b>{node.type}</b>. Everything else stays as it is, and you can undo.</> : "Select an element on the canvas, then describe the change."}
      </p>

      {!signedIn && (
        <div role="note" data-testid="ai-signin" style={{ padding: 8, background: "#eff6ff", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          {available ? "Sign in (top right) to use AI. Your project stays private; only the selected page is sent." : "AI needs an account, and this copy has no backend configured."}
        </div>
      )}

      <textarea
        aria-label="What should change?" value={text} maxLength={MAX + 200} disabled={!node || busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
        placeholder={node ? "e.g. make this darker and add a testimonial card" : "Select an element first"}
        style={{ width: "100%", minHeight: 78, padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, boxSizing: "border-box", resize: "vertical" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: trimmed.length > MAX ? "#b91c1c" : "#6b7280" }}>
        <span>Ctrl+Enter to send</span>
        <span data-testid="ai-count">{trimmed.length} / {MAX}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0" }}>
        {SUGGESTIONS.map((s) => <button key={s} style={btn} disabled={!node || busy} onClick={() => setText(s)}>{s}</button>)}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => void send()} disabled={!can} style={{ ...btn, flex: 1, background: can ? "#2563eb" : "#e5e7eb", color: can ? "#fff" : "#6b7280", borderColor: can ? "#2563eb" : "#d1d5db" }}>
          {busy ? progressText(progress) : "✦ Apply"}
        </button>
        {busy && <button onClick={cancel} style={btn}>Cancel</button>}
      </div>

      {error && <div role="alert" data-testid="ai-error" style={{ marginTop: 10, padding: 8, background: "#fef2f2", color: "#b91c1c", borderRadius: 4, fontSize: 12 }}>⚠ {error}</div>}

      {done && (
        <div role="status" data-testid="ai-done" style={{ marginTop: 10, padding: 8, background: "#f0fdf4", borderRadius: 4, fontSize: 12 }}>
          ✔ {done.summary}
          <div style={{ color: "#6b7280", marginTop: 2 }}>Changed {done.changed} element{done.changed === 1 ? "" : "s"}{done.cost ? ` · ${done.cost} credit${done.cost === 1 ? "" : "s"} used` : ""}.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {canUndo && <button style={btn} onClick={() => { undo(); setDone(null); }}>Undo</button>}
            <button style={btn} onClick={() => setDone(null)}>Keep</button>
          </div>
        </div>
      )}
    </div>
  );
}
