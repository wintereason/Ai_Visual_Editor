import { hasBlanks, PLATFORM_LEGAL, platformLegal, type PlatformLegalKind } from "@avc/templates";

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * The platform's own legal pages. They are STARTER drafts: while any [[blank]] remains in the text, a DRAFT banner is shown at the
 * top and the blanks are highlighted, so an unfinished page can't be mistaken for a finished one. Business details come from the
 * environment (NEXT_PUBLIC_BUSINESS_NAME, NEXT_PUBLIC_SUPPORT_EMAIL, NEXT_PUBLIC_BUSINESS_ADDRESS, NEXT_PUBLIC_LEGAL_COUNTRY).
 */
export function PlatformLegalPage({ kind }: { kind: PlatformLegalKind }) {
  const env = process.env;
  const blocks = platformLegal(kind, {
    business: env.NEXT_PUBLIC_BUSINESS_NAME ?? "", email: env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "", address: env.NEXT_PUBLIC_BUSINESS_ADDRESS,
    country: env.NEXT_PUBLIC_LEGAL_COUNTRY ?? "India", date: env.NEXT_PUBLIC_LEGAL_DATE ?? today(),
  });
  const draft = hasBlanks(blocks);
  const highlight = (text: string) =>
    text.split(/(\[\[[^\]]{1,200}\]\])/g).map((part, i) => (/^\[\[/.test(part) ? <mark key={i} style={{ background: "#fde68a" }}>{part}</mark> : <span key={i}>{part}</span>));

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px 64px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6, color: "#111827" }}>
      {draft && (
        <div role="note" data-testid="draft-banner" style={{ padding: 12, background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, marginBottom: 20, fontSize: 14 }}>
          <b>DRAFT, not yet reviewed.</b> This page is starter text with blanks that still need to be filled in (highlighted). It is not legal advice and must be checked, ideally by a lawyer, before you rely on it.
        </div>
      )}
      <h1>{PLATFORM_LEGAL[kind].title}</h1>
      {blocks.map(([t, text], i) => (t === "h" ? <h2 key={i} style={{ marginTop: 28 }}>{text}</h2> : <p key={i}>{highlight(text)}</p>))}
      <p style={{ marginTop: 40, fontSize: 13 }}><a href="/">← Back to the editor</a></p>
    </main>
  );
}
