import type { Node, StyleProps } from "@avc/schema";
import { newId } from "./store";

/** A ready-made, fully editable starting point. Everything here is built from the normal blocks/elements, so it validates,
 *  renders, exports and can be restyled exactly like something you built by hand. */
export type Ready = { key: string; label: string; category: string; type: string; make: () => Node };

const el = (type: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({ id: newId(), kind: "element", type, props, ...extra });
const block = (type: string, variant: string, props: Record<string, unknown>): Node => ({ id: newId(), kind: "block", type, variant, props });
const box = (children: Node[], s: StyleProps): Node => ({ id: newId(), kind: "container", type: "container", props: {}, styles: { base: { normal: s } }, children });
const P = { top: "lg", right: "lg", bottom: "lg", left: "lg" } as const;
const col = { display: "flex", direction: "column", gap: "sm", padding: P } as const;

const ready = (category: string, key: string, label: string, make: () => Node, type = make().type): Ready => ({ key, label, category, type, make });

const features3 = [{ title: "Fast", body: "Quick to set up." }, { title: "Simple", body: "Easy to use." }, { title: "Flexible", body: "Fits your needs." }];
const features6 = [...features3, { title: "Secure", body: "Safe by default." }, { title: "Friendly", body: "Help when you need it." }, { title: "Reliable", body: "Works every day." }];
const heroBase = { headline: "Your headline here", subheadline: "A short supporting line.", ctaLabel: "Get started", ctaHref: "#" };

export const READY: Ready[] = [
  // ---- Hero ----
  ready("Hero", "hero-centered", "Hero · centered", () => block("hero", "centered", heroBase)),
  ready("Hero", "hero-split", "Hero · split", () => block("hero", "split", heroBase)),
  ready("Hero", "hero-minimal", "Hero · minimal", () => block("hero", "minimal", { headline: "Say it simply" })),
  ready("Hero", "hero-launch", "Hero · launch", () => block("hero", "centered", { headline: "Something new is coming", subheadline: "Be the first to know when we open.", ctaLabel: "Notify me", ctaHref: "#contact" })),
  ready("Hero", "hero-event", "Hero · event", () => block("hero", "split", { headline: "Join us on 1 January", subheadline: "A day of talks, food and friends.", ctaLabel: "Reserve a seat", ctaHref: "#" })),

  // ---- Navigation & footer ----
  ready("Navigation", "nav-simple", "Navbar · simple", () => block("navbar", "simple", { brand: "Brand", links: [{ label: "Home", href: "/" }, { label: "About", href: "#about" }] })),
  ready("Navigation", "nav-centered", "Navbar · centered", () => block("navbar", "centered", { brand: "Brand", links: [{ label: "Home", href: "/" }, { label: "Services", href: "#services" }, { label: "Contact", href: "#contact" }] })),
  ready("Navigation", "nav-cta", "Navbar · with button", () => block("navbar", "cta", { brand: "Brand", links: [{ label: "Home", href: "/" }, { label: "Pricing", href: "#pricing" }], ctaLabel: "Sign up", ctaHref: "#" })),
  ready("Navigation", "footer-simple", "Footer · simple", () => block("footer", "simple", { copyright: "© Your Company", links: [] })),
  ready("Navigation", "footer-columns", "Footer · columns", () => block("footer", "columns", { copyright: "© Your Company", links: [{ label: "About", href: "#about" }, { label: "Contact", href: "#contact" }, { label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }] })),

  // ---- Features ----
  ready("Features", "features-cards", "Features · cards", () => block("featureGrid", "cards", { title: "Features", items: features3 })),
  ready("Features", "features-plain", "Features · plain", () => block("featureGrid", "plain", { title: "Why choose us", items: features3 })),
  ready("Features", "features-six", "Features · six", () => block("featureGrid", "cards", { title: "Everything you need", items: features6 })),
  ready("Features", "steps-h", "Steps · across", () => block("steps", "horizontal", { title: "How it works", items: [{ title: "Sign up", body: "Create your account." }, { title: "Choose", body: "Pick what suits you." }, { title: "Start", body: "Begin right away." }] })),
  ready("Features", "steps-v", "Steps · down", () => block("steps", "vertical", { title: "Getting started", items: [{ title: "Step one", body: "Tell us what you need." }, { title: "Step two", body: "We set it up." }, { title: "Step three", body: "You are ready." }] })),
  ready("Features", "stats-row", "Stats · row", () => block("stats", "row", { title: "Our results", items: [{ value: "500+", label: "Students" }, { value: "92%", label: "Pass rate" }, { value: "15", label: "Teachers" }] })),
  ready("Features", "stats-cards", "Stats · cards", () => block("stats", "cards", { items: [{ value: "10k", label: "Visitors" }, { value: "4.9", label: "Rating" }, { value: "24/7", label: "Support" }, { value: "50+", label: "Countries" }] })),

  // ---- Social proof ----
  ready("Proof", "testimonial-card", "Testimonial · card", () => block("testimonial", "card", { quote: "This changed how we work.", author: "A. Customer", role: "Founder" })),
  ready("Proof", "testimonial-quote", "Testimonial · big quote", () => block("testimonial", "quote", { quote: "The best decision we made this year.", author: "R. Sharma", role: "Parent" })),
  ready("Proof", "logos", "Logo strip", () => block("logoStrip", "simple", { title: "Trusted by", logos: [{ name: "Company One" }, { name: "Company Two" }, { name: "Company Three" }, { name: "Company Four" }] })),
  ready("Proof", "team-cards", "Team · cards", () => block("team", "cards", { title: "Meet the team", members: [{ name: "Asha Rao", role: "Founder", bio: "Short bio." }, { name: "Ravi Kumar", role: "Teacher", bio: "Short bio." }, { name: "Meera Shah", role: "Counsellor", bio: "Short bio." }] })),
  ready("Proof", "team-plain", "Team · plain", () => block("team", "plain", { title: "Our people", members: [{ name: "Asha Rao", role: "Founder" }, { name: "Ravi Kumar", role: "Teacher" }] })),

  // ---- Pricing & calls to action ----
  ready("Pricing", "pricing-two", "Pricing · two plans", () => block("pricing", "cards", { title: "Plans", plans: [{ name: "Basic", price: "₹299", period: "month", features: ["One feature", "Another feature"], ctaLabel: "Choose Basic", ctaHref: "#" }, { name: "Pro", price: "₹799", period: "month", features: ["Everything in Basic", "Priority support"], ctaLabel: "Choose Pro", ctaHref: "#", highlighted: true }] })),
  ready("Pricing", "pricing-three", "Pricing · three plans", () => block("pricing", "cards", { title: "Simple pricing", plans: [{ name: "Free", price: "₹0", features: ["One feature"], ctaLabel: "Start free", ctaHref: "#" }, { name: "Standard", price: "₹499", period: "month", features: ["Everything in Free", "More features"], ctaLabel: "Choose Standard", ctaHref: "#", highlighted: true }, { name: "Premium", price: "₹999", period: "month", features: ["Everything in Standard", "Priority support"], ctaLabel: "Choose Premium", ctaHref: "#" }] })),
  ready("Pricing", "cta-primary", "Call to action · bold", () => block("ctaBanner", "primary", { headline: "Ready to get started?", subheadline: "Join today.", ctaLabel: "Get started", ctaHref: "#" })),
  ready("Pricing", "cta-surface", "Call to action · soft", () => block("ctaBanner", "surface", { headline: "Have a question?", subheadline: "We are happy to help.", ctaLabel: "Contact us", ctaHref: "#contact" })),

  // ---- Content ----
  ready("Content", "faq", "FAQ", () => block("faq", "simple", { title: "Questions and answers", items: [{ question: "What is included?", answer: "Everything you need to get started." }, { question: "How do I contact you?", answer: "Use the contact form and we will reply within a day." }, { question: "Can I cancel?", answer: "Yes, at any time." }] })),
  ready("Content", "gallery", "Gallery · grid", () => block("gallery", "grid", { title: "Gallery", images: [1, 2, 3, 4, 5, 6].map((n) => ({ src: "https://placehold.co/600x450", alt: `Placeholder photo ${n}` })) })),
  ready("Content", "contact", "Contact form", () => block("contactForm", "simple", { title: "Get in touch", submitLabel: "Send" })),
  ready("Content", "about", "About · text and picture", () => box([
    box([el("heading", { text: "About us", level: 2 }), el("text", { text: "Tell your story here. Who you are, what you do and why it matters." }), el("button", { label: "Learn more", href: "#" }, { variant: "outline" })], { display: "flex", direction: "column", gap: "md", justify: "center" }),
    el("image", { src: "https://placehold.co/600x400", alt: "Placeholder image", fit: "cover", mask: "rounded" }),
  ], { display: "grid", columns: 2, gap: "xl", align: "center", padding: P })),

  // ---- Cards & layout ----
  ready("Cards", "card-basic", "Card", () => box([el("heading", { text: "Card title", level: 3 }), el("text", { text: "A short description goes here." }), el("link", { text: "Read more", href: "#" })], { ...col, background: "theme.surface", radius: { tl: "md", tr: "md", br: "md", bl: "md" }, shadow: "sm" })),
  ready("Cards", "card-image", "Card · with picture", () => box([el("image", { src: "https://placehold.co/600x400", alt: "Placeholder image", fit: "cover" }), el("heading", { text: "Card title", level: 3 }), el("text", { text: "A short description goes here." })], { ...col, background: "theme.surface", radius: { tl: "md", tr: "md", br: "md", bl: "md" }, shadow: "md" })),
  ready("Cards", "card-highlight", "Card · highlighted", () => box([el("heading", { text: "Good to know", level: 3 }), el("text", { text: "Use this to make one message stand out." })], { ...col, background: "theme.primary", color: "#FFFFFF", radius: { tl: "md", tr: "md", br: "md", bl: "md" } })),
  ready("Cards", "card-quote", "Pull quote", () => box([el("text", { text: "“A short quote that deserves attention.”" }, { styles: { base: { normal: { fontSize: "xl", fontWeight: 600 } } } }), el("text", { text: "— Name, role" })], { ...col, border: { width: 2, style: "solid", color: "theme.primary" }, radius: { tl: "md", tr: "md", br: "md", bl: "md" } })),
  ready("Layout", "cols-2", "Two columns", () => box([box([el("heading", { text: "Left", level: 3 }), el("text", { text: "Text" })], { display: "flex", direction: "column", gap: "sm" }), box([el("heading", { text: "Right", level: 3 }), el("text", { text: "Text" })], { display: "flex", direction: "column", gap: "sm" })], { display: "grid", columns: 2, gap: "lg", padding: P })),
  ready("Layout", "cols-3", "Three columns", () => box([1, 2, 3].map((n) => box([el("heading", { text: `Item ${n}`, level: 3 }), el("text", { text: "Text" })], { display: "flex", direction: "column", gap: "sm" })), { display: "grid", columns: 3, gap: "lg", padding: P })),
  ready("Layout", "cols-4", "Four columns", () => box([1, 2, 3, 4].map((n) => box([el("heading", { text: `${n}`, level: 3 }), el("text", { text: "Text" })], { display: "flex", direction: "column", gap: "sm" })), { display: "grid", columns: 4, gap: "md", padding: P })),
  ready("Layout", "banner", "Colour band", () => box([el("heading", { text: "A band of colour", level: 2 }), el("text", { text: "Great for announcements." })], { display: "flex", direction: "column", align: "center", gap: "sm", padding: { top: "xl", right: "lg", bottom: "xl", left: "lg" }, background: { type: "linear", angle: 135, stops: [{ color: "theme.primary", at: 0 }, { color: "theme.secondary", at: 100 }] }, color: "#FFFFFF", textAlign: "center" })),
  ready("Layout", "spacer-big", "Big space", () => el("spacer", {}, { styles: { base: { normal: { minHeight: { value: 96, unit: "px" } } } } })),

  // ---- Buttons ----
  ready("Buttons", "btn-solid", "Button · solid", () => el("button", { label: "Click me", href: "#" }, { variant: "solid" })),
  ready("Buttons", "btn-outline", "Button · outline", () => el("button", { label: "Click me", href: "#" }, { variant: "outline" })),
  ready("Buttons", "btn-ghost", "Button · ghost", () => el("button", { label: "Click me", href: "#" }, { variant: "ghost" })),
  ready("Buttons", "btn-pill", "Button · pill", () => el("button", { label: "Get started", href: "#" }, { variant: "solid", styles: { base: { normal: { radius: { tl: 999, tr: 999, br: 999, bl: 999 } } } } })),
  ready("Buttons", "btn-big", "Button · large", () => el("button", { label: "Start now", href: "#" }, { variant: "solid", styles: { base: { normal: { fontSize: "lg", padding: { top: "md", right: "xl", bottom: "md", left: "xl" } } } } })),
  ready("Buttons", "btn-glow", "Button · hover glow", () => el("button", { label: "Hover me", href: "#" }, { variant: "solid", animation: { preset: "hover-glow", trigger: "hover" } })),
  ready("Buttons", "btn-pair", "Two buttons", () => box([el("button", { label: "Get started", href: "#" }, { variant: "solid" }), el("button", { label: "Learn more", href: "#" }, { variant: "outline" })], { display: "flex", direction: "row", gap: "md", wrap: true })),

  // ---- Text ----
  ready("Text", "h-title", "Big title", () => el("heading", { text: "A big bold title", level: 1 }, { styles: { base: { normal: { fontSize: "2xl", fontWeight: 800 } } } })),
  ready("Text", "h-center", "Centered heading", () => el("heading", { text: "Section heading", level: 2 }, { styles: { base: { normal: { textAlign: "center" } } } })),
  ready("Text", "h-sub", "Subheading", () => el("heading", { text: "A smaller heading", level: 3 })),
  ready("Text", "t-lead", "Lead paragraph", () => el("text", { text: "An introduction that is a little larger, to draw people in." }, { styles: { base: { normal: { fontSize: "lg", color: "theme.muted" } } } })),
  ready("Text", "t-body", "Paragraph", () => el("text", { text: "Write something here." })),
  ready("Text", "t-center", "Centered paragraph", () => el("text", { text: "Write something here." }, { styles: { base: { normal: { textAlign: "center" } } } })),
  ready("Text", "t-marquee", "Scrolling text", () => el("text", { text: "★ Big news ★ Big news ★ Big news ★ Big news ★" }, { animation: { preset: "marquee", trigger: "load" } })),
  ready("Text", "t-bullets", "Bullet list", () => el("list", { items: ["First point", "Second point", "Third point"], ordered: false })),
  ready("Text", "t-numbers", "Numbered list", () => el("list", { items: ["First step", "Second step", "Third step"], ordered: true })),
  ready("Text", "t-link", "Link", () => el("link", { text: "Learn more", href: "#" })),

  // ---- Pictures & lines ----
  ready("Pictures", "img-plain", "Picture", () => el("image", { src: "https://placehold.co/600x400", alt: "Placeholder image", fit: "cover" })),
  ready("Pictures", "img-rounded", "Picture · rounded", () => el("image", { src: "https://placehold.co/600x400", alt: "Placeholder image", fit: "cover", mask: "rounded" })),
  ready("Pictures", "img-circle", "Picture · circle", () => el("image", { src: "https://placehold.co/400x400", alt: "Placeholder portrait", fit: "cover", mask: "circle" }, { styles: { base: { normal: { width: { value: 200, unit: "px" } } } } })),
  ready("Pictures", "img-wide", "Picture · wide", () => el("image", { src: "https://placehold.co/1200x500", alt: "Placeholder banner", fit: "cover" }, { styles: { base: { normal: { aspectRatio: "12 / 5" } } } })),
  ready("Pictures", "line", "Line", () => el("divider", {})),
  ready("Pictures", "line-thick", "Line · thick", () => el("divider", {}, { styles: { base: { normal: { border: { width: 4, style: "solid", color: "theme.primary" }, width: { value: 80, unit: "px" } } } } })),
];

export const READY_CATEGORIES = ["All", ...Array.from(new Set(READY.map((r) => r.category)))];
