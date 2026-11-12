import type { Node, Page } from "@avc/schema";

// STARTER legal pages. These are plain-language drafts to save time, NOT legal advice. They are written so they cannot be
// published by accident without a human looking at them:
//   * every page opens with a notice node whose id starts "legal_notice": the pre-publish check refuses to publish while it exists;
//   * anything the author must decide is written as [[a blank like this]]: the pre-publish check refuses to publish while any remain.
// A person (ideally a qualified lawyer) should read, adjust and then delete the notice.

export type LegalKind = "privacy" | "terms" | "refunds";
export type LegalInput = {
  business: string;
  email: string;
  /** Postal address, optional. */
  address?: string;
  /** Country whose law applies, e.g. "India". */
  country: string;
  /** True when the site has a contact form (messages are collected). */
  hasForm: boolean;
  /** True when site analytics are switched on. */
  hasAnalytics: boolean;
  /** Date shown as "Last updated", e.g. "10 November 2026". */
  date: string;
};

export const LEGAL_PAGES: Record<LegalKind, { name: string; path: string; description: string }> = {
  privacy: { name: "Privacy Policy", path: "/privacy", description: "What information this site collects and how it is used." },
  terms: { name: "Terms of Use", path: "/terms", description: "The rules for using this website." },
  refunds: { name: "Refund and Cancellation Policy", path: "/refunds", description: "When fees can be refunded or a booking cancelled." },
};

type Block = ["h", string] | ["p", string];

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function privacy(i: LegalInput): Block[] {
  const b = i.business;
  return [
    ["p", `${b} ("we", "us") respects your privacy. This page explains what information we collect through this website, why, and the choices you have. Last updated: ${i.date}.`],
    ["h", "What we collect"],
    ["p", i.hasForm
      ? "When you send us a message through the contact form, we receive the details you type in: usually your name, email address and message. We collect nothing else about you through the form."
      : "This website does not collect personal information from visitors through forms."],
    ["p", i.hasAnalytics
      ? "We use a website analytics service to count visits and see which pages are popular. It reports totals (such as page views and countries), does not build a profile of you, and we do not use it to identify individuals. [[Confirm this matches the analytics service you actually use]]"
      : "We do not run website analytics or advertising trackers on this site. [[Update this if you add any]]"],
    ["p", "Our hosting provider may keep ordinary technical logs (such as IP address and browser type) for security and reliability."],
    ["h", "How we use it"],
    ["p", "We use your message only to reply to you and to run our services. We do not sell your information."],
    ["h", "How long we keep it"],
    ["p", "We keep messages for [[how long, for example 12 months]] and then delete them, unless the law requires us to keep them longer."],
    ["h", "Sharing"],
    ["p", "We share information only with service providers who help us run this website (for example our website host), and when the law requires it."],
    ["h", "Your choices"],
    ["p", `You can ask us to show you, correct or delete the information we hold about you by emailing ${i.email}. We will respond within [[number of days]] days.`],
    ["h", "Children"],
    ["p", "This website is not meant for children to use alone. If you believe a child has sent us personal information, please contact us and we will delete it."],
    ["h", "Changes"],
    ["p", "If we change this policy we will update the date at the top of this page."],
    ["h", "Contact"],
    ["p", `${b}${i.address ? `, ${i.address}` : ""}. Email: ${i.email}.`],
  ];
}

function terms(i: LegalInput): Block[] {
  const b = i.business;
  return [
    ["p", `These terms apply when you use this website, which is run by ${b}. By using it you agree to them. Last updated: ${i.date}.`],
    ["h", "Using this website"],
    ["p", "You may use this website for lawful purposes only. Do not try to break, overload or gain unauthorised access to it, and do not send harmful or unlawful material through it."],
    ["h", "Our content"],
    ["p", `The text, images and design on this website belong to ${b} or its licensors. You may view and share links to the site, but please do not copy it for your own commercial use without asking us first.`],
    ["h", "Information is for guidance"],
    ["p", "We try to keep the information here accurate and up to date, but it may change and we do not promise it is complete. Check important details (such as fees, dates and eligibility) with us directly."],
    ["h", "Links to other sites"],
    ["p", "We may link to other websites. We do not control them and are not responsible for their content."],
    ["h", "Limits on our responsibility"],
    ["p", `To the extent the law allows, ${b} is not liable for losses that result from using this website or relying on its content. Nothing here limits any right you have under the law that cannot be limited. [[Have this section checked by a lawyer]]`],
    ["h", "Changes"],
    ["p", "We may update these terms. The date at the top shows when they last changed."],
    ["h", "Governing law"],
    ["p", `These terms are governed by the laws of ${i.country}. [[Name the city or state whose courts will handle disputes]]`],
    ["h", "Contact"],
    ["p", `Questions about these terms: ${i.email}.`],
  ];
}

function refunds(i: LegalInput): Block[] {
  const b = i.business;
  return [
    ["p", `This page explains how fees paid to ${b} can be cancelled or refunded. Last updated: ${i.date}.`],
    ["h", "Cancelling"],
    ["p", `You can cancel an enrolment or booking by emailing ${i.email} within [[number of days]] days of paying.`],
    ["h", "Refunds"],
    ["p", "If you cancel in time, we will refund [[the full fee / the fee minus a deduction, say which]] to the original payment method within [[number of days]] working days."],
    ["p", "After that period, fees are [[not refundable / refundable only in these cases: list them]]."],
    ["h", "If we cancel"],
    ["p", "If we cancel a class or programme, we will offer a full refund or a place in a later one, whichever you prefer."],
    ["h", "Contact"],
    ["p", `Refund questions: ${i.email}.`],
  ];
}

const BUILDERS: Record<LegalKind, (i: LegalInput) => Block[]> = { privacy, terms, refunds };

/**
 * The body of a legal page: one section holding a title, the "starter text" notice, then headings and paragraphs.
 * `newId` supplies unique node ids. Add the site's own navbar and footer around it.
 */
export function legalBody(kind: LegalKind, input: LegalInput, newId: () => string): Node {
  const i: LegalInput = { ...input, business: clean(input.business, 80) || "[[your business name]]", email: clean(input.email, 120) || "[[your email address]]", address: input.address ? clean(input.address, 200) : undefined, country: clean(input.country, 60) || "India", date: clean(input.date, 40) };
  const meta = LEGAL_PAGES[kind];
  const kids: Node[] = [
    { id: newId(), kind: "element", type: "heading", props: { text: meta.name, level: 1 } },
    // Must be deleted by the author before the site can be published (see the pre-publish check).
    { id: "legal_notice_" + newId(), kind: "element", type: "text", props: { text: "STARTER TEXT: this page is a draft to save you time, not legal advice. Fill in the [[blanks]], check every sentence is true for your business, ideally have a lawyer read it, then delete this notice." } },
    ...BUILDERS[kind](i).map<Node>(([t, text]) => t === "h"
      ? { id: newId(), kind: "element", type: "heading", props: { text, level: 2 } }
      : { id: newId(), kind: "element", type: "text", props: { text } }),
  ];
  return { id: newId(), kind: "container", type: "section", props: {}, styles: { base: { normal: { padding: { top: "xl", bottom: "xl", left: "lg", right: "lg" }, maxWidth: { value: 820, unit: "px" } } } }, children: kids } as Node;
}

/** A complete page (body only; the editor adds the site's navbar and footer). */
export function legalPage(kind: LegalKind, input: LegalInput, id: string, newId: () => string, path?: string): Page {
  const meta = LEGAL_PAGES[kind];
  return { id, name: meta.name, path: path ?? meta.path, seo: { title: meta.name, description: meta.description }, nodes: [legalBody(kind, input, newId)] };
}
