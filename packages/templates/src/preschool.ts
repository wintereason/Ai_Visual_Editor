import type { Project } from "@avc/schema";
import { makeIds, makeProject, page, siteKit } from "./build";

const BRAND = "Little Sprouts Preschool";
const NAV = [
  { label: "Home", href: "/" },
  { label: "Programs", href: "/programs" },
  { label: "A day with us", href: "/day" },
  { label: "Contact", href: "/contact" },
];

/** Sample copy only: ages, timings and fees are placeholders. */
export function preschoolTemplate(): Project {
  const id = makeIds("p");
  const k = siteKit(id, BRAND, NAV, "Book a visit", "/contact");
  const seo = (t: string) => `${t} | ${BRAND}`;

  return makeProject("tpl_preschool", BRAND, { primary: "#0f766e", secondary: "#f97316" }, "Poppins", [
    page("page_home", "Home", "/", seo("Home"), "A warm, play-based preschool where little ones learn through discovery.", [
      k.nav(),
      k.hero("split", "Where little ones love to learn", "A warm, play-based preschool for children aged 2 to 6, with caring teachers and a safe, happy space.", "Book a visit", "/contact", true),
      k.grid("Our approach", [
        { title: "Play-based learning", body: "Children learn best through play, stories and exploration." },
        { title: "Caring teachers", body: "Trained, patient teachers who know every child by name." },
        { title: "Safe and clean", body: "Child-safe furniture, CCTV and strict hygiene routines." },
        { title: "Parent updates", body: "Daily notes and photos so you never miss a moment." },
      ]),
      k.quotes("From our parents", ["She skips into school every morning.", "Parent name", "Parent of a 3-year-old"], ["The teachers are so patient and warm.", "Parent name", "Parent of a 4-year-old"]),
      k.cta("Come and see for yourself", "Book a visit and meet our teachers."),
      k.foot(),
    ]),
    page("page_programs", "Programs", "/programs", seo("Programs"), "Playgroup, nursery, junior and senior KG.", [
      k.nav(),
      k.hero("minimal", "Our programs", "The right program for each age."),
      k.grid("By age", [
        { title: "Playgroup (2-3 years)", body: "Gentle first steps: songs, sensory play and social time." },
        { title: "Nursery (3-4 years)", body: "Early language, numbers, art and group activities." },
        { title: "Junior KG (4-5 years)", body: "Pre-reading, pre-writing and number sense." },
        { title: "Senior KG (5-6 years)", body: "School readiness: reading, writing and confidence." },
      ]),
      k.info("Timings and fees", ["Morning batch: 9 am to 12 pm", "Day care: until 5 pm (optional)", "Monthly fees listed at the office"], "Sample details: replace with your own."),
      k.foot(),
    ]),
    page("page_day", "A day with us", "/day", seo("A day with us"), "What a typical day looks like.", [
      k.nav(),
      k.hero("minimal", "A day with us", "Routine helps little ones feel safe."),
      k.steps("Daily routine", [
        { title: "Welcome circle", body: "Greetings, songs and the day's story." },
        { title: "Learning play", body: "Letters, numbers and hands-on activities." },
        { title: "Snack time", body: "Healthy snacks and good habits." },
        { title: "Outdoor play", body: "Safe time outside to run and explore." },
        { title: "Art and music", body: "Creative time every day." },
        { title: "Story and goodbye", body: "A calm end to the day." },
      ], "vertical"),
      k.foot(),
    ]),
    page("page_contact", "Contact", "/contact", seo("Contact"), "Book a visit.", [
      k.nav(),
      ...k.contact("Book a visit", "Come and see our classrooms. We would love to meet you.", "Request a visit", "Request a visit", ["Address: your street, your city", "Phone: +91 00000 00000", "Hours: Mon-Sat, 8:30 am to 5 pm"]),
      k.foot(),
    ]),
  ]);
}
