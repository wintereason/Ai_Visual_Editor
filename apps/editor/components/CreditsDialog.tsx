"use client";
import { useCallback, useEffect, useState } from "react";
import { getBilling, openCheckout, startOrder, verifyPayment, type BillingInfo, type PublicPack } from "../lib/billing";
import { useCloud } from "../lib/cloud";

const btn: React.CSSProperties = { padding: "5px 12px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 13 };

/** The signed-in person's AI credit balance, and the way to buy more. */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const email = useCloud((s) => s.user?.email ?? "");
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // pack id being bought

  const load = useCallback(async () => {
    const r = await getBilling();
    if (r.ok) { setInfo(r); setError(null); } else setError(r.message);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const buy = async (pack: PublicPack) => {
    setBusy(pack.id); setNote(null); setError(null);
    try {
      const order = await startOrder(pack.id);
      if (!order.ok) { setError(order.message); return; }
      const outcome = await openCheckout(order, email);
      if (outcome.kind === "unavailable") { setError("Couldn't open the payment window. Check your connection or disable any blocker for this page, then try again."); return; }
      if (outcome.kind === "dismissed") { setNote({ ok: false, text: "The payment window was closed. If you were charged, your credits will arrive automatically within a few minutes." }); return; }
      if (outcome.kind === "failed") { setNote({ ok: false, text: "The payment didn't go through. You can try again." }); return; }
      setNote({ ok: true, text: "Payment received. Adding your credits…" });
      const v = await verifyPayment({ orderId: outcome.payment.razorpay_order_id, paymentId: outcome.payment.razorpay_payment_id, signature: outcome.payment.razorpay_signature });
      if (v.ok) { setNote({ ok: true, text: `✔ ${order.credits} credits added.` }); setInfo((i) => (i ? { ...i, balance: v.balance } : i)); }
      else setNote({ ok: false, text: v.message });
      void load(); // the webhook may also have added them: show the real balance
    } finally { setBusy(null); }
  };

  return (
    <div role="dialog" aria-label="Credits" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 20, width: 440, maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>AI credits</h3>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div style={{ margin: "10px 0", fontSize: 14 }}>You have <b data-testid="credit-balance">{info ? info.balance : "…"}</b> credits.</div>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>Credits pay for AI requests. A request that fails, or is blocked by the safety check, is not charged.</p>

        {info && !info.enabled && <div role="note" style={{ padding: 10, background: "#fffbeb", borderRadius: 6, fontSize: 13 }}>Buying credits isn&apos;t open yet.</div>}
        {info?.enabled && info.packs.map((p) => (
          <div key={p.id} data-testid={`pack-${p.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f3f4f6" }}>
            <span style={{ flex: 1 }}><b>{p.label}</b><br /><span style={{ fontSize: 12, color: "#6b7280" }}>{p.credits} credits</span></span>
            <span style={{ fontWeight: 600 }}>{p.price}</span>
            <button style={{ ...btn, background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} disabled={busy !== null} onClick={() => void buy(p)} aria-label={`Buy ${p.label}`}>{busy === p.id ? "Opening…" : "Buy"}</button>
          </div>
        ))}
        {info?.enabled && (
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 10 }}>
            Payments are processed by Razorpay; we never see your card details. By buying you agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>, the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and the <a href="/refunds" target="_blank" rel="noopener noreferrer">Refund Policy</a>.
          </p>
        )}
        {note && <div role={note.ok ? "status" : "alert"} data-testid="credit-note" style={{ marginTop: 8, fontSize: 13, color: note.ok ? "#15803d" : "#92400e" }}>{note.text}</div>}
        {error && <div role="alert" data-testid="credit-error" style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>⚠ {error}</div>}
      </div>
    </div>
  );
}
