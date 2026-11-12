import type { Project } from "@avc/schema";
import { makeIds, makeProject, page, siteKit } from "./build";

const BRAND = "SkillNest Online";
const NAV = [
  { label: "Home", href: "/" },
  { label: "Courses", href: "/courses" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
];

/** Sample copy only: course names, prices and claims are placeholders. */
export function onlineTemplate(): Project {
  const id = makeIds("o");
  const k = siteKit(id, BRAND, NAV, "Start learning", "/pricing");
  const seo = (t: string) => `${t} | ${BRAND}`;

  return makeProject("tpl_online", BRAND, { primary: "#6d28d9", secondary: "#f97316" }, "Poppins", [
    page("page_home", "Home", "/", seo("Home"), "Learn practical skills online at your own pace, with live support from mentors.", [
      k.nav(),
      k.hero("centered", "Learn job-ready skills online", "Short, practical courses with mentor support. Learn at your own pace, from anywhere.", "Browse courses", "/courses", true),
      k.steps("How it works", [
        { title: "Pick a course", body: "Choose a skill and a learning path." },
        { title: "Learn and practise", body: "Short videos, exercises and projects." },
        { title: "Get support", body: "Ask mentors questions in weekly live sessions." },
        { title: "Earn a certificate", body: "Finish the project and download your certificate." },
      ]),
      k.grid("Popular topics", [
        { title: "Web development", body: "Build real websites from scratch." },
        { title: "Data analysis", body: "Spreadsheets, SQL and dashboards." },
        { title: "Digital marketing", body: "Social media, SEO and ads." },
        { title: "Spoken English", body: "Speak confidently at work and interviews." },
        { title: "Graphic design", body: "Design basics with practical projects." },
        { title: "Accounting basics", body: "Bookkeeping and Tally for beginners." },
      ], "plain"),
      k.quotes("Learner stories", ["I finished my first project in two weeks.", "Learner name", "Web development learner"], ["Live sessions made hard topics easy to follow.", "Learner name", "Data analysis learner"]),
      k.cta("Start with a free lesson", "No payment needed to try the first lesson."),
      k.foot(),
    ]),
    page("page_courses", "Courses", "/courses", seo("Courses"), "Browse all courses.", [
      k.nav(),
      k.hero("minimal", "All courses", "Beginner-friendly, project-based learning."),
      k.grid("Course catalogue", [
        { title: "Web Development Bootcamp", body: "HTML, CSS, JavaScript and a final project. 8 weeks." },
        { title: "Data Analysis with Excel and SQL", body: "From raw data to dashboards. 6 weeks." },
        { title: "Digital Marketing Essentials", body: "Plan and run campaigns. 5 weeks." },
        { title: "Spoken English for Work", body: "Speaking practice with a mentor. 8 weeks." },
        { title: "Graphic Design Basics", body: "Layout, colour and typography. 4 weeks." },
        { title: "Accounting and Tally", body: "Bookkeeping to reports. 6 weeks." },
      ]),
      k.cta("Not sure where to start?", "Talk to a learning advisor.", "Contact us", "/contact"),
      k.foot(),
    ]),
    page("page_pricing", "Pricing", "/pricing", seo("Pricing"), "Simple pricing for every learner.", [
      k.nav(),
      k.hero("minimal", "Simple pricing", "Pay per course or learn everything with a plan."),
      k.pricing("Plans", [
        { name: "Free", price: "₹0", features: ["First lesson of every course", "Community access"], ctaLabel: "Start free", ctaHref: "/contact" },
        { name: "Course", price: "₹2,999", period: "course", features: ["One course", "Mentor support", "Certificate"], ctaLabel: "Choose a course", ctaHref: "/courses" },
        { name: "All access", price: "₹799", period: "month", features: ["Every course", "Live sessions", "Projects and reviews"], ctaLabel: "Get all access", ctaHref: "/contact", highlighted: true },
      ]),
      k.faq("Common questions", [
        { question: "Can I try before paying?", answer: "Sample answer: replace with your policy. The first lesson of every course is free." },
        { question: "Do I get a certificate?", answer: "Sample answer: replace with your details." },
        { question: "What is the refund policy?", answer: "Sample answer: replace with your refund policy." },
      ]),
      k.info("What is included", ["Video lessons and practice exercises", "Weekly live mentor sessions", "Project reviews", "Certificate of completion", "7-day refund policy"], "Sample prices and policy: replace with your own."),
      k.foot(),
    ]),
    page("page_contact", "Contact", "/contact", seo("Contact"), "Talk to a learning advisor.", [
      k.nav(),
      ...k.contact("Talk to an advisor", "Tell us your goal and we will suggest a path.", "Send a message", "Send message", ["Email: hello@example.com", "WhatsApp: +91 00000 00000", "Support hours: Mon-Sat, 10 am to 7 pm"]),
      k.foot(),
    ]),
  ]);
}
