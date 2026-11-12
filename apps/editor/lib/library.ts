import type { Node } from "@avc/schema";
import { newId } from "./store";

export type LibraryItem = { type: string; label: string; group: "Structure" | "Elements" | "Blocks"; make: () => Node };

const el = (type: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({
  id: newId(), kind: "element", type, props, ...extra,
});
const block = (type: string, variant: string, props: Record<string, unknown>): Node => ({
  id: newId(), kind: "block", type, variant, props,
});

export const LIBRARY: LibraryItem[] = [
  { type: "section", label: "Section", group: "Structure", make: () => ({ id: newId(), kind: "container", type: "section", props: {}, children: [] }) },
  { type: "container", label: "Container", group: "Structure", make: () => ({ id: newId(), kind: "container", type: "container", props: {}, styles: { base: { normal: { display: "flex", direction: "row", gap: "md", padding: { top: "md", right: "md", bottom: "md", left: "md" } } } }, children: [] }) },

  { type: "heading", label: "Heading", group: "Elements", make: () => el("heading", { text: "New heading", level: 2 }) },
  { type: "text", label: "Text", group: "Elements", make: () => el("text", { text: "Write something here." }) },
  { type: "button", label: "Button", group: "Elements", make: () => el("button", { label: "Click me", href: "#" }, { variant: "solid" }) },
  { type: "image", label: "Image", group: "Elements", make: () => el("image", { src: "https://placehold.co/600x400", alt: "Placeholder image", fit: "cover" }) },
  { type: "divider", label: "Divider", group: "Elements", make: () => el("divider", {}) },
  { type: "spacer", label: "Spacer", group: "Elements", make: () => el("spacer", {}, { styles: { base: { normal: { minHeight: { value: 32, unit: "px" } } } } }) },
  { type: "list", label: "List", group: "Elements", make: () => el("list", { items: ["One", "Two", "Three"], ordered: false }) },
  { type: "link", label: "Link", group: "Elements", make: () => el("link", { text: "Learn more", href: "#" }) },

  { type: "navbar", label: "Navbar", group: "Blocks", make: () => block("navbar", "simple", { brand: "Brand", links: [{ label: "Home", href: "/" }, { label: "About", href: "#about" }] }) },
  { type: "hero", label: "Hero", group: "Blocks", make: () => block("hero", "centered", { headline: "Your headline here", subheadline: "A short supporting line.", ctaLabel: "Get started", ctaHref: "#" }) },
  { type: "featureGrid", label: "Feature grid", group: "Blocks", make: () => block("featureGrid", "cards", { title: "Features", items: [{ title: "Fast", body: "Quick to set up." }, { title: "Simple", body: "Easy to use." }, { title: "Flexible", body: "Fits your needs." }] }) },
  { type: "testimonial", label: "Testimonial", group: "Blocks", make: () => block("testimonial", "card", { quote: "This changed how we work.", author: "A. Customer", role: "Founder" }) },
  { type: "contactForm", label: "Contact form", group: "Blocks", make: () => block("contactForm", "simple", { title: "Get in touch", submitLabel: "Send" }) },
  { type: "stats", label: "Stats", group: "Blocks", make: () => block("stats", "row", { title: "Our results", items: [{ value: "500+", label: "Students" }, { value: "92%", label: "Pass rate" }, { value: "15", label: "Teachers" }] }) },
  { type: "steps", label: "Steps", group: "Blocks", make: () => block("steps", "horizontal", { title: "How it works", items: [{ title: "Sign up", body: "Create your account." }, { title: "Choose", body: "Pick what suits you." }, { title: "Start", body: "Begin right away." }] }) },
  { type: "faq", label: "FAQ", group: "Blocks", make: () => block("faq", "simple", { title: "Questions and answers", items: [{ question: "What is included?", answer: "Everything you need to get started." }, { question: "How do I contact you?", answer: "Use the contact form and we will reply within a day." }] }) },
  { type: "pricing", label: "Pricing", group: "Blocks", make: () => block("pricing", "cards", { title: "Plans", plans: [{ name: "Basic", price: "₹299", period: "month", features: ["One feature", "Another feature"], ctaLabel: "Choose Basic", ctaHref: "#" }, { name: "Pro", price: "₹799", period: "month", features: ["Everything in Basic", "Priority support"], ctaLabel: "Choose Pro", ctaHref: "#", highlighted: true }] }) },
  { type: "team", label: "Team", group: "Blocks", make: () => block("team", "cards", { title: "Meet the team", members: [{ name: "Asha Rao", role: "Founder", bio: "Short bio." }, { name: "Ravi Kumar", role: "Teacher", bio: "Short bio." }, { name: "Meera Shah", role: "Counsellor", bio: "Short bio." }] }) },
  { type: "logoStrip", label: "Logo strip", group: "Blocks", make: () => block("logoStrip", "simple", { title: "Trusted by", logos: [{ name: "Company One" }, { name: "Company Two" }, { name: "Company Three" }] }) },
  { type: "ctaBanner", label: "CTA banner", group: "Blocks", make: () => block("ctaBanner", "primary", { headline: "Ready to get started?", subheadline: "Join today.", ctaLabel: "Get started", ctaHref: "#" }) },
  { type: "gallery", label: "Gallery", group: "Blocks", make: () => block("gallery", "grid", { title: "Gallery", images: [{ src: "https://placehold.co/600x450", alt: "Placeholder photo 1" }, { src: "https://placehold.co/600x450", alt: "Placeholder photo 2" }, { src: "https://placehold.co/600x450", alt: "Placeholder photo 3" }] }) },
  { type: "footer", label: "Footer", group: "Blocks", make: () => block("footer", "simple", { copyright: "© Your Company", links: [] }) },
];

import { ALL_ITEMS } from "./catalog";

/** Looks up anything draggable from the panel: a basic item (by type) or a ready-made one (by key). */
export function findDraggable(key: string): { label: string; type: string; make: () => Node } | undefined {
  const base = LIBRARY.find((i) => i.type === key);
  if (base) return base;
  return ALL_ITEMS.find((r) => r.key === key);
}
