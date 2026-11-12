import type { Node, Page, Project } from "@avc/schema";
import { block, heading, makeIds, page, section, text } from "./build";

/**
 * Starter apps for the "Mobile app" project type: a screen header, content, and a bottom tab bar on every screen.
 * Sample copy only: every name, date and number below is placeholder text to be replaced by the owner.
 */
type Tab = { label: string; href: string; icon: string };

function appPage(id: () => string, tabs: Tab[], path: string, name: string, desc: string, header: Node, body: Node[]): Page {
  const tabBar = block(id, "tabBar", "bottom", { items: tabs });
  return page(`page_${path === "/" ? "home" : path.slice(1)}`, name, path, `${name} | App`, desc, [section(id, [header, ...body, tabBar])]);
}
const colored = (id: () => string, title: string, subtitle: string): Node => block(id, "appHeader", "colored", { title, subtitle });
const plain = (id: () => string, title: string, extra: Record<string, unknown> = {}): Node => block(id, "appHeader", "plain", { title, backHref: "/", ...extra });

export function schoolAppTemplate(): Project {
  const id = makeIds("sa");
  const tabs: Tab[] = [
    { label: "Home", href: "/", icon: "home" },
    { label: "Classes", href: "/classes", icon: "book" },
    { label: "Notices", href: "/notices", icon: "bell" },
    { label: "Contact", href: "/contact", icon: "phone" },
  ];
  const mk = (path: string, name: string, desc: string, header: Node, body: Node[]) => appPage(id, tabs, path, name, desc, header, body);

  const home = mk("/", "Home", "Today at school: timetable, fees and notices.", colored(id, "Greenfield School", "Parent app"), [
    block(id, "appList", "inset", { title: "Today", items: [
      { title: "Timetable", subtitle: "Starts 8:30 am (sample)", icon: "clock", href: "/classes" },
      { title: "Latest notice", subtitle: "Annual day rehearsal (sample)", icon: "bell", href: "/notices", badge: "New" },
      { title: "Fee due date", subtitle: "5th of every month (sample)", icon: "calendar" },
    ] }),
    block(id, "stats", "cards", { items: [{ value: "96%", label: "Attendance (sample)" }, { value: "A", label: "Last grade (sample)" }] }),
    block(id, "appList", "inset", { title: "Quick links", items: [
      { title: "Meet a teacher", icon: "users", href: "/contact" },
      { title: "School calendar", icon: "calendar", href: "/notices" },
    ] }),
  ]);
  const classes = mk("/classes", "Classes", "Subjects and teachers.", plain(id, "Classes"), [
    block(id, "appList", "plain", { items: [
      { title: "Mathematics", subtitle: "Ms. Rao (sample)", icon: "bar-chart", href: "#" },
      { title: "Science", subtitle: "Mr. Kumar (sample)", icon: "bulb", href: "#" },
      { title: "English", subtitle: "Ms. Shah (sample)", icon: "book", href: "#" },
      { title: "Art", subtitle: "Mr. Das (sample)", icon: "sparkles", href: "#" },
    ] }),
  ]);
  const notices = mk("/notices", "Notices", "News and announcements.", plain(id, "Notices"), [
    block(id, "appList", "inset", { title: "This week", items: [
      { title: "Annual day rehearsal", subtitle: "Friday, 3 pm (sample)", icon: "star", badge: "New" },
      { title: "Parent meeting", subtitle: "Saturday, 10 am (sample)", icon: "users" },
      { title: "Holiday", subtitle: "School closed on Monday (sample)", icon: "flag" },
    ] }),
  ]);
  const contact = mk("/contact", "Contact", "Reach the school office.", plain(id, "Contact"), [
    block(id, "appList", "inset", { items: [
      { title: "Call the office", subtitle: "+91 00000 00000 (sample)", icon: "phone", href: "tel:+910000000000" },
      { title: "Email", subtitle: "office@example.com (sample)", icon: "mail", href: "mailto:office@example.com" },
      { title: "Find us", subtitle: "Your street, your city (sample)", icon: "pin" },
    ] }),
    heading(id, "Send a message", 3),
    text(id, "Use the form below. We reply within a day (sample text)."),
    block(id, "contactForm", "simple", { title: "Message the office", submitLabel: "Send" }),
  ]);

  return {
    schemaVersion: 2, id: "tpl_school_app", name: "Greenfield School", platform: "mobile",
    theme: {
      colors: { primary: "#166534", secondary: "#ca8a04", background: "#ffffff", surface: "#f0fdf4", text: "#14281d", muted: "#4b5563" },
      fonts: { heading: "Poppins", body: "Inter" }, radius: "lg", motion: "subtle",
    },
    app: { shortName: "Greenfield", display: "standalone", offline: true },
    pages: [home, classes, notices, contact],
  };
}

export function coachingAppTemplate(): Project {
  const id = makeIds("ca");
  const tabs: Tab[] = [
    { label: "Home", href: "/", icon: "home" },
    { label: "Batches", href: "/batches", icon: "users" },
    { label: "Results", href: "/results", icon: "trophy" },
    { label: "Help", href: "/help", icon: "chat" },
  ];
  const mk = (path: string, name: string, desc: string, header: Node, body: Node[]) => appPage(id, tabs, path, name, desc, header, body);

  const home = mk("/", "Home", "Batches, results and help in one place.", colored(id, "BrightPath", "Study app"), [
    block(id, "appList", "inset", { title: "Continue", items: [
      { title: "Maths: Algebra", subtitle: "Class 3 of 12 (sample)", icon: "play", href: "/batches" },
      { title: "Weekly test", subtitle: "Saturday, 9 am (sample)", icon: "calendar", badge: "Soon" },
    ] }),
    block(id, "stats", "cards", { items: [{ value: "12", label: "Classes done (sample)" }, { value: "78%", label: "Last test (sample)" }, { value: "4", label: "Day streak (sample)" }] }),
    block(id, "appList", "inset", { title: "Explore", items: [
      { title: "All batches", icon: "users", href: "/batches" },
      { title: "Toppers", icon: "trophy", href: "/results" },
      { title: "Ask a doubt", icon: "chat", href: "/help" },
    ] }),
  ]);
  const batches = mk("/batches", "Batches", "Courses you can join.", plain(id, "Batches"), [
    block(id, "appList", "plain", { items: [
      { title: "Foundation (Class 9-10)", subtitle: "6 months (sample)", icon: "book", href: "#" },
      { title: "JEE Main", subtitle: "1 year (sample)", icon: "bulb", href: "#" },
      { title: "NEET", subtitle: "1 year (sample)", icon: "leaf", href: "#" },
    ] }),
  ]);
  const results = mk("/results", "Results", "Our recent results.", plain(id, "Results"), [
    block(id, "stats", "cards", { items: [{ value: "92%", label: "Pass rate (sample)" }, { value: "120+", label: "Top ranks (sample)" }] }),
    block(id, "appList", "inset", { title: "Recent toppers", items: [
      { title: "A. Student", subtitle: "98.4% (sample)", icon: "award" },
      { title: "B. Student", subtitle: "97.1% (sample)", icon: "award" },
    ] }),
  ]);
  const help = mk("/help", "Help", "Ask us anything.", plain(id, "Help"), [
    block(id, "appList", "inset", { items: [
      { title: "WhatsApp us", subtitle: "+91 00000 00000 (sample)", icon: "chat", href: "tel:+910000000000" },
      { title: "Email", subtitle: "help@example.com (sample)", icon: "mail", href: "mailto:help@example.com" },
    ] }),
    block(id, "faq", "simple", { title: "Common questions", items: [
      { question: "How do I join a batch?", answer: "Open Batches and tap the one you want (sample answer)." },
      { question: "Can I change my batch?", answer: "Yes, contact us within the first week (sample answer)." },
    ] }),
  ]);

  return {
    schemaVersion: 2, id: "tpl_coaching_app", name: "BrightPath", platform: "mobile",
    theme: {
      colors: { primary: "#1d4ed8", secondary: "#f59e0b", background: "#ffffff", surface: "#eff6ff", text: "#0f172a", muted: "#475569" },
      fonts: { heading: "Montserrat", body: "Roboto" }, radius: "lg", motion: "subtle",
    },
    app: { shortName: "BrightPath", display: "standalone", offline: true },
    pages: [home, batches, results, help],
  };
}
