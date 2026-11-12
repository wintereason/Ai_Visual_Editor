"use client";
import { LEGAL_PAGES, legalBody, type LegalInput, type LegalKind } from "@avc/templates";
import type { Node, PatchOp as Op, Page } from "@avc/schema";
import { useState } from "react";
import { cloneWithNewIds, newId, useEditor } from "../lib/store";

const field: React.CSSProperties = { width: "100%", padding: "5px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, boxSizing: "border-box" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "8px 0 3px", display: "block" };
const KINDS = Object.keys(LEGAL_PAGES) as LegalKind[];

const hasBlock = (section: Node | undefined, type: string) => !!section && (section.children ?? []).some((c) => c.type === type);
const walk = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...walk(n.children ?? [])]);

/** Today's date in plain words, e.g. "10 November 2026". */
const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * Adds starter Privacy / Terms / Refund pages that use the site's own navbar and footer, and links them from every footer.
 * The pages are blocked from publishing until a person fills in the [[blanks]] and deletes the starter-text notice.
 */
export function LegalPages() {
  const { project, setPage, commit } = useEditor();
  const [open, setOpen] = useState(false);
  const [business, setBusiness] = useState(project.name);
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [country, setCountry] = useState("India");
  const [analytics, setAnalytics] = useState(false);
  const [picked, setPicked] = useState<Record<LegalKind, boolean>>({ privacy: true, terms: true, refunds: false });

  const existing = (k: LegalKind) => project.pages.some((p) => p.path === LEGAL_PAGES[k].path);
  const hasForm = walk(project.pages.flatMap((p) => p.nodes)).some((n) => n.type === "contactForm");
  const chosen = KINDS.filter((k) => picked[k] && !existing(k));
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const can = chosen.length > 0 && business.trim() !== "" && emailOk;

  const add = () => {
    if (!can) return;
    const home = project.pages.find((p) => p.path === "/") ?? project.pages[0]!;
    const nav = home.nodes[0] && hasBlock(home.nodes[0], "navbar") ? home.nodes[0] : undefined;
    const foot = home.nodes.length > 1 && hasBlock(home.nodes[home.nodes.length - 1], "footer") ? home.nodes[home.nodes.length - 1] : undefined;
    const input: LegalInput = { business, email: email.trim(), address: address.trim() || undefined, country, hasForm, hasAnalytics: analytics, date: today() };

    const pages: Page[] = chosen.map((k) => ({
      id: newId("page"), name: LEGAL_PAGES[k].name, path: LEGAL_PAGES[k].path, seo: { title: LEGAL_PAGES[k].name, description: LEGAL_PAGES[k].description },
      nodes: [...(nav ? [cloneWithNewIds(nav)] : []), legalBody(k, input, () => newId()), ...(foot ? [cloneWithNewIds(foot)] : [])],
    }));
    const ops: Op[] = pages.map((page) => ({ op: "addPage", page }));

    // link the legal pages from the footer of every page that has one (existing pages and the new ones)
    const links = KINDS.filter((k) => existing(k) || chosen.includes(k)).map((k) => ({ label: LEGAL_PAGES[k].name, href: LEGAL_PAGES[k].path }));
    const withLinks = (p: Page): Op[] =>
      p.nodes.flatMap((s) => (s.children ?? []).filter((c) => c.type === "footer").map<Op>((f) => {
        const have = ((f.props as { links?: { label: string; href: string }[] }).links ?? []);
        const merged = [...have, ...links.filter((l) => !have.some((h) => h.href === l.href))].slice(0, 10);
        return { op: "update", id: f.id, props: { links: merged } };
      }));
    for (const p of [...project.pages, ...pages]) {
      for (const o of withLinks(p)) {
        // a footer cloned into a new page isn't in the project yet; those get their links by being built from the updated clone below
        if (project.pages.some((x) => x.id === p.id)) ops.push(o);
      }
    }
    for (const page of pages) for (const s of page.nodes) for (const c of s.children ?? []) if (c.type === "footer") {
      const have = ((c.props as { links?: { label: string; href: string }[] }).links ?? []);
      (c.props as Record<string, unknown>).links = [...have, ...links.filter((l) => !have.some((h) => h.href === l.href))].slice(0, 10);
    }

    // a patch holds at most 20 operations; the new pages come first so they always fit
    if (commit({ summary: "Add legal pages", ops: ops.slice(0, 20) })) setPage(pages[0]!.id);
  };

  return (
    <div style={{ borderTop: "1px solid #e5e7eb", margin: "14px 0 4px", paddingTop: 10 }} data-testid="legal-pages">
      <button aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>⚖ {open ? "Hide legal pages" : "Add legal pages…"}</button>
      {open && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div role="note" style={{ padding: 8, background: "#fffbeb", borderRadius: 4, color: "#92400e" }}>
            These are <b>starter drafts, not legal advice</b>. You must fill in the blanks and check every sentence; ideally have a lawyer read them. The site can&apos;t be published until you do.
          </div>
          <span style={label}>Business name</span>
          <input aria-label="Business name" style={field} value={business} maxLength={80} onChange={(e) => setBusiness(e.target.value)} />
          <span style={label}>Contact email (shown on the pages)</span>
          <input aria-label="Contact email" style={field} value={email} maxLength={120} placeholder="hello@yourbusiness.com" onChange={(e) => setEmail(e.target.value)} />
          <span style={label}>Address (optional)</span>
          <input aria-label="Address" style={field} value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
          <span style={label}>Country whose law applies</span>
          <input aria-label="Country" style={field} value={country} maxLength={60} onChange={(e) => setCountry(e.target.value)} />
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> My site uses analytics
          </label>
          <div style={{ color: "#6b7280", marginTop: 2 }}>{hasForm ? "A contact form was found, so the privacy page describes collecting messages." : "No contact form found."}</div>
          <span style={label}>Pages</span>
          {KINDS.map((k) => (
            <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 0", opacity: existing(k) ? 0.5 : 1 }}>
              <input type="checkbox" disabled={existing(k)} checked={picked[k] && !existing(k)} onChange={(e) => setPicked({ ...picked, [k]: e.target.checked })} /> {LEGAL_PAGES[k].name} {existing(k) && <span style={{ color: "#6b7280" }}>(already added)</span>}
            </label>
          ))}
          {email && !emailOk && <div style={{ color: "#b91c1c", marginTop: 4 }}>Enter a valid email address.</div>}
          <button disabled={!can} onClick={add} style={{ marginTop: 10, padding: "5px 12px", cursor: can ? "pointer" : "default", background: can ? "#2563eb" : "#e5e7eb", color: can ? "#fff" : "#6b7280", border: 0, borderRadius: 4 }}>Add {chosen.length || ""} page{chosen.length === 1 ? "" : "s"}</button>
        </div>
      )}
    </div>
  );
}
