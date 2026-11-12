// Built-in graphics: icons and shapes. Drawn here (not loaded from anywhere), so they cost no network request, can't be blocked,
// and take the page's colours: shapes and icons are painted with `currentColor`, which the Style panel's "Text colour" sets.

export type IconDef = { label: string; tags: string; d: string };
const i = (label: string, tags: string, d: string): IconDef => ({ label, tags, d });

/** 24x24 line icons (stroke 2, round caps). Names are stable: saved pages refer to them. */
export const ICONS: Readonly<Record<string, IconDef>> = {
  star: i("Star", "favorite rating", "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"),
  heart: i("Heart", "love like", "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"),
  check: i("Check", "tick done yes", "M5 12l5 5L20 7"),
  close: i("Close", "x cross no", "M6 6l12 12M18 6L6 18"),
  plus: i("Plus", "add new", "M12 5v14M5 12h14"),
  minus: i("Minus", "remove less", "M5 12h14"),
  "arrow-right": i("Arrow right", "next forward", "M5 12h14M13 6l6 6-6 6"),
  "arrow-left": i("Arrow left", "back previous", "M19 12H5M11 6l-6 6 6 6"),
  "arrow-up": i("Arrow up", "top rise", "M12 19V5M6 11l6-6 6 6"),
  "arrow-down": i("Arrow down", "bottom", "M12 5v14M6 13l6 6 6-6"),
  "chevron-right": i("Chevron", "more next", "M9 6l6 6-6 6"),
  home: i("Home", "house main", "M4 11l8-7 8 7M6 10v10h12V10"),
  mail: i("Mail", "email message letter", "M4 6h16v12H4zM4 7l8 6 8-6"),
  phone: i("Phone", "call contact", "M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"),
  pin: i("Location", "map place address", "M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"),
  clock: i("Clock", "time hours", "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2"),
  calendar: i("Calendar", "date event schedule", "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"),
  user: i("Person", "profile account", "M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0"),
  users: i("People", "team group community", "M9 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a6 6 0 0 1 4 6"),
  book: i("Book", "read course learn", "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"),
  graduation: i("Graduation", "school college degree education", "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"),
  award: i("Award", "medal prize quality", "M12 9m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M8.5 14L7 21l5-3 5 3-1.5-7"),
  trophy: i("Trophy", "win champion result", "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M10 18h4"),
  bulb: i("Idea", "light bulb tip", "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"),
  shield: i("Shield", "safe secure protect", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"),
  lock: i("Lock", "private password secure", "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3"),
  globe: i("Globe", "world web international", "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"),
  camera: i("Camera", "photo picture", "M3 8h4l2-3h6l2 3h4v12H3zM12 14m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0"),
  image: i("Picture", "photo gallery", "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"),
  music: i("Music", "song audio", "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"),
  play: i("Play", "video start", "M7 4l13 8-13 8z"),
  chat: i("Chat", "message talk comment", "M4 5h16v11H9l-5 4z"),
  bell: i("Bell", "notification alert", "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"),
  sliders: i("Settings", "options adjust", "M4 7h10M18 7h2M4 17h2M10 17h10M16 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"),
  search: i("Search", "find magnify", "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4"),
  menu: i("Menu", "list lines hamburger", "M4 6h16M4 12h16M4 18h16"),
  download: i("Download", "save get", "M12 4v11M7 10l5 5 5-5M4 20h16"),
  upload: i("Upload", "send share", "M12 20V9M7 14l5-5 5 5M4 4h16"),
  link: i("Link", "chain url", "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  cart: i("Cart", "shop buy store", "M3 4h3l2 11h10l2-8H7M9 20m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M17 20m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0"),
  gift: i("Gift", "present offer", "M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7C9 7 8 3 10.5 3 12 3 12 5 12 7zM12 7c3 0 4-4 1.5-4C12 3 12 5 12 7z"),
  sun: i("Sun", "day bright", "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"),
  moon: i("Moon", "night dark", "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"),
  leaf: i("Leaf", "nature eco green", "M5 19C5 10 10 5 20 4c0 10-5 15-14 15zM5 19l8-8"),
  coffee: i("Coffee", "cafe drink break", "M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2"),
  code: i("Code", "develop program", "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"),
  "bar-chart": i("Growth", "chart statistics", "M5 20V10M12 20V4M19 20v-7"),
  layers: i("Layers", "stack photo compose", "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"),
  flag: i("Flag", "goal milestone", "M5 21V4M5 4h12l-2 4 2 4H5"),
  "thumbs-up": i("Thumbs up", "like good approve", "M7 11v9H4v-9zM7 11l4-7c2 0 3 1 3 3v3h5a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2H7"),
  sparkles: i("Sparkles", "magic new special", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"),
};
export const ICON_NAMES = Object.keys(ICONS);

export type ShapeDef = { label: string; /** SVG markup inside a 0..100 box, painted with currentColor. */ svg: string };

/** n-pointed star centred in the 100 box. */
function star(points: number, outer: number, inner: number): string {
  const out: string[] = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? outer : inner;
    const a = (Math.PI * k) / points - Math.PI / 2;
    out.push(`${+(50 + r * Math.cos(a)).toFixed(1)},${+(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${out.join(" ")}"/>`;
}
const poly = (pts: string) => `<polygon points="${pts}"/>`;
const path = (d: string, extra = "") => `<path d="${d}"${extra}/>`;

export const SHAPES: Readonly<Record<string, ShapeDef>> = {
  square: { label: "Square", svg: `<rect x="4" y="4" width="92" height="92"/>` },
  rounded: { label: "Rounded square", svg: `<rect x="4" y="4" width="92" height="92" rx="20"/>` },
  circle: { label: "Circle", svg: `<circle cx="50" cy="50" r="46"/>` },
  ellipse: { label: "Oval", svg: `<ellipse cx="50" cy="50" rx="46" ry="30"/>` },
  triangle: { label: "Triangle", svg: poly("50,6 95,92 5,92") },
  "right-triangle": { label: "Right triangle", svg: poly("6,6 94,94 6,94") },
  diamond: { label: "Diamond", svg: poly("50,4 96,50 50,96 4,50") },
  pentagon: { label: "Pentagon", svg: poly("50,5 96,39 78,93 22,93 4,39") },
  hexagon: { label: "Hexagon", svg: poly("27,8 73,8 96,50 73,92 27,92 4,50") },
  octagon: { label: "Octagon", svg: poly("30,5 70,5 95,30 95,70 70,95 30,95 5,70 5,30") },
  star: { label: "Star", svg: star(5, 47, 19) },
  "star-4": { label: "Sparkle", svg: star(4, 47, 13) },
  burst: { label: "Burst", svg: star(12, 47, 36) },
  heart: { label: "Heart", svg: path("M50 90C12 62 6 36 22 20c12-12 26-6 28 6 2-12 16-18 28-6 16 16 10 42-28 70z") },
  "arrow-right": { label: "Arrow", svg: poly("4,34 56,34 56,12 96,50 56,88 56,66 4,66") },
  chevron: { label: "Chevron", svg: poly("4,10 60,10 96,50 60,90 4,90 40,50") },
  cross: { label: "Plus", svg: poly("36,4 64,4 64,36 96,36 96,64 64,64 64,96 36,96 36,64 4,64 4,36 36,36") },
  "half-circle": { label: "Half circle", svg: path("M4 70A46 46 0 0 1 96 70z") },
  ring: { label: "Ring", svg: path("M50 4a46 46 0 1 0 0.01 0zM50 24a26 26 0 1 1-0.01 0z", ` fill-rule="evenodd"`) },
  parallelogram: { label: "Slanted", svg: poly("25,15 96,15 75,85 4,85") },
  trapezoid: { label: "Trapezoid", svg: poly("22,15 78,15 96,85 4,85") },
  bubble: { label: "Speech bubble", svg: path("M12 10h76a8 8 0 0 1 8 8v46a8 8 0 0 1-8 8H42L22 92V72h-10a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z") },
  blob: { label: "Blob", svg: path("M52 6C74 4 94 22 92 46c-2 26-20 48-44 46C24 90 6 72 8 48 10 26 30 8 52 6z") },
  ribbon: { label: "Banner", svg: poly("4,22 96,22 82,50 96,78 4,78 18,50") },
  bolt: { label: "Lightning", svg: poly("58,4 20,56 46,56 38,96 80,40 54,40") },
  crescent: { label: "Crescent", svg: path("M60 6A44 44 0 1 0 94 64 36 36 0 0 1 60 6z") },
};
export const SHAPE_NAMES = Object.keys(SHAPES);

export const CHART_TYPES = ["bar", "row", "line", "area", "pie", "donut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
