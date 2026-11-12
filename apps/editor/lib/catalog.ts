import { ICONS, ICON_NAMES, SHAPES, SHAPE_NAMES, type Node } from "@avc/schema";
import { READY, type Ready } from "./readymade";
import { newId } from "./store";

/** Anything the person can drag onto the page. `type` is the kind of node it makes (drop rules depend on it). */
export type CatItem = Ready & { tags?: string };

const el = (type: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({ id: newId(), kind: "element", type, props, ...extra });
const item = (category: string, key: string, label: string, type: string, make: () => Node, tags = ""): CatItem => ({ key, label, category, type, make, tags });

export const SHAPE_ITEMS: CatItem[] = SHAPE_NAMES.map((n) => item("Shapes", `shape-${n}`, SHAPES[n]!.label, "shape", () => el("shape", { shape: n }), n));
export const ICON_ITEMS: CatItem[] = ICON_NAMES.map((n) => item("Icons", `icon-${n}`, ICONS[n]!.label, "icon", () => el("icon", { name: n }), `${n} ${ICONS[n]!.tags}`));

const months = [{ label: "Jan", value: 30 }, { label: "Feb", value: 45 }, { label: "Mar", value: 38 }, { label: "Apr", value: 62 }, { label: "May", value: 55 }];
const shares = [{ label: "Online", value: 55 }, { label: "In person", value: 30 }, { label: "Other", value: 15 }];
const subjects = [{ label: "Maths", value: 82 }, { label: "Science", value: 74 }, { label: "English", value: 91 }, { label: "History", value: 68 }];
export const CHART_ITEMS: CatItem[] = [
  item("Charts", "chart-bar", "Bar chart", "chart", () => el("chart", { chartType: "bar", title: "Results by month", data: months }), "column compare"),
  item("Charts", "chart-row", "Row chart", "chart", () => el("chart", { chartType: "row", title: "Average score", data: subjects }), "horizontal bar compare"),
  item("Charts", "chart-line", "Line chart", "chart", () => el("chart", { chartType: "line", title: "Growth", data: months }), "trend over time"),
  item("Charts", "chart-area", "Area chart", "chart", () => el("chart", { chartType: "area", title: "Visitors", data: months }), "trend filled"),
  item("Charts", "chart-pie", "Pie chart", "chart", () => el("chart", { chartType: "pie", title: "Where students come from", data: shares }), "share percent"),
  item("Charts", "chart-donut", "Donut chart", "chart", () => el("chart", { chartType: "donut", title: "Budget split", data: shares }), "share percent ring"),
];

export const TABLE_ITEMS: CatItem[] = [
  item("Tables", "table-prices", "Price list", "table", () => el("table", { caption: "Fees", columns: ["Course", "Duration", "Fee"], rows: ["Foundation | 6 months | ₹12,000", "Advanced | 1 year | ₹20,000", "Crash course | 2 months | ₹6,000"] }), "fees cost"),
  item("Tables", "table-timetable", "Timetable", "table", () => el("table", { caption: "This week", columns: ["Time", "Mon", "Tue", "Wed"], rows: ["9:00 | Maths | Science | English", "10:00 | Science | English | Maths", "11:00 | English | Maths | Science"] }), "schedule classes"),
  item("Tables", "table-compare", "Comparison", "table", () => el("table", { columns: ["Feature", "Basic", "Pro"], rows: ["Live classes | 2 / week | Daily", "Recorded lessons | Yes | Yes", "Mentor support | - | Yes"] }), "plans features"),
  item("Tables", "table-hours", "Opening hours", "table", () => el("table", { columns: ["Day", "Hours"], rows: ["Monday to Friday | 9 am to 6 pm", "Saturday | 10 am to 2 pm", "Sunday | Closed"] }), "timings"),
];

export const EMBED_ITEMS: CatItem[] = [
  item("Maps", "embed-map", "Map", "embed", () => el("embed", { provider: "map", url: "https://www.openstreetmap.org/export/embed.html?bbox=77.19%2C28.60%2C77.25%2C28.65&layer=mapnik" }, { styles: { base: { normal: { minHeight: { value: 320, unit: "px" }, width: "fill" } } } }), "location directions address"),
];

// ---- photo layers: a fixed-shape canvas whose layers are placed by percentage, so the whole composition scales together ----
const layer = (node: Node, place: { x: number; y: number; w: number; r?: number }): Node => ({ ...node, place });
const lText = (text: string, place: { x: number; y: number; w: number }, style: Record<string, unknown> = {}): Node => layer(el("text", { text }, { styles: { base: { normal: style } } } as never), place);
const lHead = (text: string, place: { x: number; y: number; w: number }, style: Record<string, unknown> = {}): Node => layer(el("heading", { text, level: 2 }, { styles: { base: { normal: style } } } as never), place);
const lPhoto = (w = 100, h = "16 / 9"): Node => layer(el("image", { src: "https://placehold.co/1200x800", alt: "Placeholder photo", fit: "cover" }, { styles: { base: { normal: { aspectRatio: h } } } } as never), { x: 0, y: 0, w });
const MAX_W: Record<string, number> = { "16 / 9": 760, "4 / 3": 640, "1 / 1": 520, "3 / 4": 480, "9 / 16": 360 };
const group = (aspect: string, children: Node[], bg?: unknown, label?: string): Node => ({ id: newId(), kind: "layerGroup", type: "layerGroup", props: { aspect, ...(label ? { label } : {}) }, children, styles: { base: { normal: { maxWidth: { value: MAX_W[aspect] ?? 640, unit: "px" }, ...(bg ? { background: bg } : {}) } } } } as Node);
const gradient = (a: string, b: string, angle = 135) => ({ type: "linear", angle, stops: [{ color: a, at: 0 }, { color: b, at: 100 }] });
/** A full-width band covering `h`% of the group's height, starting `y`% down. `gw / gh` is the group's shape. */
const bar = (y: number, h: number, color: string, opacity: number, gw = 16, gh = 9): Node => layer(el("shape", { shape: "square" }, { styles: { base: { normal: { color, opacity, aspectRatio: `100 / ${+((h * gh) / gw).toFixed(2)}` } } } } as never), { x: 0, y, w: 100 });

export const LAYER_ITEMS: CatItem[] = [
  item("Photo layers", "layers-caption", "Photo with caption", "layerGroup", () => group("16 / 9", [lPhoto(), bar(72, 28, "#000000", 0.55), lText("A short caption about this photo", { x: 5, y: 78, w: 90 }, { color: "#FFFFFF" })], undefined, "Photo with a caption"), "picture overlay text"),
  item("Photo layers", "layers-badge", "Photo with badge", "layerGroup", () => group("4 / 3", [lPhoto(100, "4 / 3"), layer(el("shape", { shape: "burst" }, { styles: { base: { normal: { color: "theme.secondary" } } } } as never), { x: 66, y: 6, w: 28, r: 12 }), lText("NEW", { x: 71, y: 17, w: 18 }, { color: "#111827", fontWeight: 800, textAlign: "center" })], undefined, "Photo with a NEW badge"), "sticker label sale"),
  item("Photo layers", "layers-title", "Photo with title", "layerGroup", () => group("16 / 9", [lPhoto(), bar(0, 100, "#000000", 0.35), lHead("Your big title", { x: 8, y: 34, w: 84 }, { color: "#FFFFFF", fontSize: "2xl", textAlign: "center" })], undefined, "Photo with a title"), "hero banner"),
  item("Photo layers", "layers-square", "Square post", "layerGroup", () => group("1 / 1", [layer(el("shape", { shape: "circle" }, { styles: { base: { normal: { color: "#FFFFFF", opacity: 0.18 } } } } as never), { x: 55, y: -15, w: 70 }), lHead("Big idea", { x: 10, y: 38, w: 80 }, { color: "#FFFFFF", fontSize: "2xl" }), lText("One line that explains it", { x: 10, y: 62, w: 80 }, { color: "#FFFFFF" })], gradient("#1D4ED8", "#7C3AED"), "Square announcement"), "social instagram announcement"),
  item("Photo layers", "layers-story", "Story", "layerGroup", () => group("9 / 16", [layer(el("shape", { shape: "blob" }, { styles: { base: { normal: { color: "#FFFFFF", opacity: 0.2 } } } } as never), { x: -20, y: 55, w: 90 }), lHead("Open day", { x: 10, y: 20, w: 80 }, { color: "#FFFFFF", fontSize: "2xl" }), lText("Saturday, 10 am", { x: 10, y: 38, w: 80 }, { color: "#FFFFFF" })], gradient("#EA580C", "#DB2777", 160), "Story announcement"), "vertical reel"),
  item("Photo layers", "layers-poster", "Poster", "layerGroup", () => group("3 / 4", [layer(el("shape", { shape: "ring" }, { styles: { base: { normal: { color: "#FFFFFF", opacity: 0.25 } } } } as never), { x: 40, y: 50, w: 70 }), lHead("Annual day", { x: 10, y: 14, w: 80 }, { color: "#FFFFFF", fontSize: "2xl" }), lText("Join us for songs, plays and prizes.", { x: 10, y: 30, w: 70 }, { color: "#FFFFFF" }), layer(el("icon", { name: "star" }, { styles: { base: { normal: { color: "theme.secondary" } } } } as never), { x: 12, y: 60, w: 14 })], gradient("#0F172A", "#334155", 180), "Poster"), "flyer event"),
  item("Photo layers", "layers-blank", "Blank canvas", "layerGroup", () => group("16 / 9", [lHead("Start here", { x: 10, y: 38, w: 80 }, { textAlign: "center" })], "theme.surface", "Blank canvas"), "empty custom artwork"),
];

// ---- app screens (for the Mobile app project type) ----
const blockNode = (type: string, variant: string, props: Record<string, unknown>): Node => ({ id: newId(), kind: "block", type, variant, props });
const tab = (label: string, icon: string, href = "#") => ({ label, icon, href });
export const APP_ITEMS: CatItem[] = [
  item("App screens", "app-header", "Screen header", "appHeader", () => blockNode("appHeader", "plain", { title: "Screen title", subtitle: "A short line" }), "title bar top"),
  item("App screens", "app-header-colored", "Coloured header", "appHeader", () => blockNode("appHeader", "colored", { title: "Welcome", subtitle: "Today at a glance" }), "title bar top brand"),
  item("App screens", "app-header-back", "Header with back", "appHeader", () => blockNode("appHeader", "plain", { title: "Details", backHref: "/", actionLabel: "Edit", actionHref: "#" }), "back action"),
  item("App screens", "app-tabs-3", "Tab bar · 3 tabs", "tabBar", () => blockNode("tabBar", "bottom", { items: [tab("Home", "home", "/"), tab("Search", "search"), tab("Profile", "user")] }), "bottom navigation menu"),
  item("App screens", "app-tabs-4", "Tab bar · 4 tabs", "tabBar", () => blockNode("tabBar", "bottom", { items: [tab("Home", "home", "/"), tab("Learn", "book"), tab("Alerts", "bell"), tab("Contact", "phone")] }), "bottom navigation menu"),
  item("App screens", "app-tabs-5", "Tab bar · 5 tabs", "tabBar", () => blockNode("tabBar", "bottom", { items: [tab("Home", "home", "/"), tab("Search", "search"), tab("Saved", "heart"), tab("Chat", "chat"), tab("Me", "user")] }), "bottom navigation menu"),
  item("App screens", "app-list-inset", "List · rounded", "appList", () => blockNode("appList", "inset", { title: "Today", items: [{ title: "First item", subtitle: "A short description", icon: "star", href: "#" }, { title: "Second item", subtitle: "A short description", icon: "bell", href: "#", badge: "New" }, { title: "Third item", icon: "calendar" }] }), "rows menu settings"),
  item("App screens", "app-list-plain", "List · full width", "appList", () => blockNode("appList", "plain", { items: [{ title: "First item", subtitle: "A short description", icon: "book", href: "#" }, { title: "Second item", subtitle: "A short description", icon: "users", href: "#" }, { title: "Third item", subtitle: "A short description", icon: "pin", href: "#" }] }), "rows menu"),
  item("App screens", "app-list-contact", "Contact rows", "appList", () => blockNode("appList", "inset", { items: [{ title: "Call us", subtitle: "+91 00000 00000", icon: "phone", href: "tel:+910000000000" }, { title: "Email", subtitle: "hello@example.com", icon: "mail", href: "mailto:hello@example.com" }, { title: "Visit", subtitle: "Your address", icon: "pin" }] }), "phone email address"),
];
/** Preview frames for app items (width is a phone's; height fits the item). */
export const APP_FRAMES: Record<string, [number, number]> = { appHeader: [390, 100], tabBar: [390, 80], appList: [390, 280] };

export const TEXT_ITEMS: CatItem[] = [
  item("Text styles", "text-heading", "Add a heading", "heading", () => el("heading", { text: "Add a heading", level: 2 }), "title"),
  item("Text styles", "text-subheading", "Add a subheading", "heading", () => el("heading", { text: "Add a subheading", level: 3 }), "title"),
  item("Text styles", "text-body", "Add a little bit of body text", "text", () => el("text", { text: "Add a little bit of body text" }), "paragraph"),
];

const bySection = (cats: string[]) => READY.filter((r) => cats.includes(r.category));
export type Category = { id: string; label: string; icon: string; colors: [string, string]; items: CatItem[]; /** thumbnail frame, in px: [width, height] */ frame: [number, number]; columns: 1 | 2 | 3; chips?: string[] };

/** The "Browse categories" tiles on the Elements tab. */
/** Sections differ a lot in height, so each kind gets a frame that fits it (width, height in px). */
export const SECTION_FRAMES: Record<string, [number, number]> = { Hero: [800, 280], Navigation: [800, 90], Features: [800, 380], Proof: [800, 330], Pricing: [800, 420], Content: [800, 400] };

export const CATEGORIES: Category[] = [
  { id: "shapes", label: "Shapes", icon: "star", colors: ["#06b6d4", "#0e7490"], items: SHAPE_ITEMS, frame: [100, 100], columns: 3 },
  { id: "icons", label: "Icons", icon: "sparkles", colors: ["#fb923c", "#ea580c"], items: ICON_ITEMS, frame: [24, 24], columns: 3 },
  { id: "sections", label: "Sections", icon: "menu", colors: ["#60a5fa", "#2563eb"], items: bySection(["Hero", "Navigation", "Features", "Proof", "Pricing", "Content"]), frame: [800, 400], columns: 1, chips: ["Hero", "Navigation", "Features", "Proof", "Pricing", "Content"] },
  { id: "buttons", label: "Buttons", icon: "play", colors: ["#c084fc", "#9333ea"], items: bySection(["Buttons"]), frame: [200, 76], columns: 2 },
  { id: "cards", label: "Cards", icon: "book", colors: ["#f472b6", "#db2777"], items: bySection(["Cards"]), frame: [300, 240], columns: 2 },
  { id: "layouts", label: "Layouts", icon: "menu", colors: ["#34d399", "#059669"], items: bySection(["Layout"]), frame: [800, 300], columns: 2 },
  { id: "pictures", label: "Pictures", icon: "image", colors: ["#38bdf8", "#0369a1"], items: bySection(["Pictures"]), frame: [300, 200], columns: 2 },
  { id: "charts", label: "Charts", icon: "bar-chart", colors: ["#818cf8", "#4338ca"], items: CHART_ITEMS, frame: [400, 240], columns: 2 },
  { id: "app", label: "App screens", icon: "phone", colors: ["#2dd4bf", "#0f766e"], items: APP_ITEMS, frame: [390, 260], columns: 2 },
  { id: "layers", label: "Photo layers", icon: "layers", colors: ["#f59e0b", "#b45309"], items: LAYER_ITEMS, frame: [400, 300], columns: 2 },
  { id: "tables", label: "Tables", icon: "calendar", colors: ["#fb7185", "#e11d48"], items: TABLE_ITEMS, frame: [520, 240], columns: 2 },
  { id: "maps", label: "Maps", icon: "pin", colors: ["#a3e635", "#4d7c0f"], items: EMBED_ITEMS, frame: [520, 320], columns: 1 },
];

/** Every draggable thing, for search and for looking an item up when it is dropped. */
export const ALL_ITEMS: CatItem[] = [...new Map([...CATEGORIES.flatMap((c) => c.items), ...READY, ...TEXT_ITEMS].map((i) => [i.key, i])).values()];
export function searchItems(q: string, limit = 60): CatItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ALL_ITEMS.filter((i) => { const hay = `${i.label} ${i.category} ${i.tags ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, limit);
}
