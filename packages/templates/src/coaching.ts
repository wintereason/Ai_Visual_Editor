import type { Node, Project } from "@avc/schema";
import { band, block, button, card, fade, heading, list, makeIds, page, row, section, text } from "./build";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Courses", href: "/courses" },
  { label: "Teachers", href: "/teachers" },
  { label: "Contact", href: "/contact" },
];
const BRAND = "BrightPath Academy";

/** Sample copy only: every number, name and quote below is placeholder text to be replaced by the owner. */
export function coachingTemplate(): Project {
  const id = makeIds("c");
  const nav = (): Node => section(id, [block(id, "navbar", "cta", { brand: BRAND, links: NAV, ctaLabel: "Book a free demo", ctaHref: "/contact" })]);
  const foot = (): Node =>
    section(id, [block(id, "footer", "simple", { copyright: `© ${BRAND}. All rights reserved.`, links: NAV })], {
      base: { normal: { background: "theme.surface" } },
    });
  const cta = (title: string, sub: string): Node =>
    band(id, [
      heading(id, title, 2, { animation: fade }),
      text(id, sub),
      button(id, "Book a free demo class", "/contact", "solid", { base: { normal: { background: "#ffffff", color: "theme.primary" } } }),
    ], { bg: "theme.primary", color: "#ffffff", align: "center" });

  const home = page("page_home", "Home", "/", `Home | ${BRAND}`, "Expert coaching for school and competitive exams, with small batches and weekly tests.", [
    nav(),
    section(id, [
      block(id, "hero", "split", {
        headline: "Learn with mentors who care about your result",
        subheadline: "Small batches, weekly tests and doubt-clearing every day. Join a coaching institute built around your progress.",
        ctaLabel: "Book a free demo",
        ctaHref: "/contact",
      }, { animation: { preset: "fade-in", trigger: "load" } }),
    ]),
    band(id, [
      block(id, "stats", "row", { title: "Results that speak", items: [
        { value: "500+", label: "Students (sample figure: replace with yours)" },
        { value: "92%", label: "Pass rate (sample figure: replace with yours)" },
        { value: "15", label: "Expert teachers (sample figure: replace with yours)" },
      ] }),
    ], { bg: "theme.surface", align: "center" }),
    section(id, [
      block(id, "featureGrid", "cards", { title: "Why families choose us", items: [
        { title: "Small batches", body: "Maximum 20 students per batch so every child gets attention." },
        { title: "Weekly tests", body: "Regular tests with clear feedback show exactly where to improve." },
        { title: "Doubt sessions", body: "Daily doubt-clearing so no question stays unanswered." },
        { title: "Parent updates", body: "Monthly progress reports shared with parents." },
        { title: "Study material", body: "Concise notes and practice sets prepared by our faculty." },
        { title: "Flexible timings", body: "Morning and evening batches to fit school schedules." },
      ] }, { animation: fade }),
    ]),
    band(id, [
      heading(id, "What parents say", 2),
      row(id, [
        card(id, [block(id, "testimonial", "card", { quote: "My daughter's confidence in maths has completely changed.", author: "Parent name", role: "Class 10 parent" })]),
        card(id, [block(id, "testimonial", "card", { quote: "The weekly tests helped me find and fix my weak topics.", author: "Student name", role: "Class 12 student" })]),
      ]),
    ], { align: "center" }),
    cta("Ready to see the difference?", "Join a free demo class and meet our teachers before you decide."),
    foot(),
  ]);

  const courses = page("page_courses", "Courses", "/courses", `Courses | ${BRAND}`, "Courses for classes 6 to 12 and competitive exam preparation.", [
    nav(),
    section(id, [
      block(id, "hero", "minimal", { headline: "Courses for every stage", subheadline: "Choose the batch that matches your class and goal." }),
    ]),
    section(id, [
      block(id, "featureGrid", "cards", { title: "Our courses", items: [
        { title: "Foundation (Class 6-8)", body: "Strong basics in maths and science, with a focus on concepts." },
        { title: "Board Prep (Class 9-10)", body: "Complete syllabus coverage with regular practice papers." },
        { title: "Science Stream (Class 11-12)", body: "Physics, chemistry, maths and biology for boards and entrance exams." },
        { title: "Commerce Stream (Class 11-12)", body: "Accountancy, business studies and economics." },
        { title: "Entrance Exam Prep", body: "Focused preparation for competitive exams with mock tests." },
        { title: "Crash Course", body: "Intensive revision programme before exams." },
      ] }, { animation: fade }),
    ]),
    band(id, [
      heading(id, "Fee structure", 2),
      text(id, "Sample fees. Replace with your actual pricing."),
      list(id, [
        "Foundation: ₹2,000 per month",
        "Board Prep: ₹3,000 per month",
        "Science / Commerce Stream: ₹4,000 per month",
        "Entrance Exam Prep: ₹5,000 per month",
        "Sibling discount available. Ask at the front desk.",
      ]),
    ], { bg: "theme.surface" }),
    cta("Not sure which course fits?", "Talk to our counsellor, it is free."),
    foot(),
  ]);

  const teachers = page("page_teachers", "Teachers", "/teachers", `Teachers | ${BRAND}`, "Meet the teachers behind BrightPath Academy.", [
    nav(),
    section(id, [
      block(id, "hero", "minimal", { headline: "Meet our teachers", subheadline: "Experienced, patient and focused on your child's understanding." }),
    ]),
    section(id, [
      block(id, "team", "cards", { title: "Faculty", members: [
        { name: "Teacher name", role: "Mathematics", bio: "Short bio: qualification, years of experience and teaching style." },
        { name: "Teacher name", role: "Physics", bio: "Short bio: qualification, years of experience and teaching style." },
        { name: "Teacher name", role: "Chemistry", bio: "Short bio: qualification, years of experience and teaching style." },
        { name: "Teacher name", role: "Biology", bio: "Short bio: qualification, years of experience and teaching style." },
        { name: "Teacher name", role: "English", bio: "Short bio: qualification, years of experience and teaching style." },
        { name: "Teacher name", role: "Accountancy", bio: "Short bio: qualification, years of experience and teaching style." },
      ] }, { animation: fade }),
    ]),
    cta("Want to meet them in person?", "Visit for a free demo class."),
    foot(),
  ]);

  const contact = page("page_contact", "Contact", "/contact", `Contact | ${BRAND}`, "Book a free demo class or ask us a question.", [
    nav(),
    band(id, [
      heading(id, "Book a free demo class", 1),
      text(id, "Fill in the form and we will call you back within one working day."),
    ], { align: "center" }),
    section(id, [block(id, "contactForm", "simple", { title: "Send us a message", submitLabel: "Request a call back" })]),
    band(id, [
      heading(id, "Visit us", 2),
      list(id, ["Address: your street, your city", "Phone: +91 00000 00000", "Hours: Mon-Sat, 8 am to 8 pm"]),
    ], { bg: "theme.surface" }),
    foot(),
  ]);

  return {
    schemaVersion: 2,
    id: "tpl_coaching",
    name: BRAND,
    platform: "web",
    theme: {
      colors: { primary: "#1d4ed8", secondary: "#f59e0b", background: "#ffffff", surface: "#f1f5f9", text: "#0f172a", muted: "#475569" },
      fonts: { heading: "Poppins", body: "Inter" },
      radius: "md",
      motion: "subtle",
    },
    pages: [home, courses, teachers, contact],
  };
}
