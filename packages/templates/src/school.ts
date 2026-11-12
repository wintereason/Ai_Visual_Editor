import type { Project } from "@avc/schema";
import { makeIds, makeProject, page, siteKit } from "./build";

const BRAND = "Greenfield Public School";
const NAV = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Admissions", href: "/admissions" },
  { label: "Events", href: "/events" },
  { label: "Contact", href: "/contact" },
];

/** Sample copy only: names, numbers and dates are placeholders for the school to replace. */
export function schoolTemplate(): Project {
  const id = makeIds("s");
  const k = siteKit(id, BRAND, NAV, "Apply now", "/admissions");
  const seo = (t: string) => `${t} | ${BRAND}`;

  return makeProject("tpl_school", BRAND, { primary: "#15803d", secondary: "#f59e0b" }, "Poppins", [
    page("page_home", "Home", "/", seo("Home"), "A caring school where every child is known, supported and challenged.", [
      k.nav(),
      k.hero("centered", "A school where every child is known", "Nursery to Class 12 with caring teachers, safe campus and a love of learning.", "Apply for admission", "/admissions", true),
      k.grid("Why parents choose us", [
        { title: "Caring teachers", body: "Low student-teacher ratio so every child gets individual attention." },
        { title: "Safe campus", body: "CCTV, trained staff and verified transport for peace of mind." },
        { title: "Activity-rich", body: "Sports, music, art and clubs alongside academics." },
        { title: "Strong academics", body: "Concept-based teaching with regular assessments." },
        { title: "Digital classrooms", body: "Smart boards and a library with books for every age." },
        { title: "Parent partnership", body: "Open communication through meetings and monthly updates." },
      ]),
      k.quotes("Our community", ["My son looks forward to school every day.", "Parent name", "Class 4 parent"], ["The teachers helped me find confidence on stage.", "Student name", "Class 9 student"]),
      k.cta("Admissions are open", "Visit the campus and meet our teachers."),
      k.foot(),
    ]),
    page("page_about", "About", "/about", seo("About"), "Our story, values and leadership.", [
      k.nav(),
      k.hero("minimal", "About our school", "Founded on the belief that every child can thrive."),
      k.grid("Our values", [
        { title: "Respect", body: "For ourselves, each other and our environment." },
        { title: "Curiosity", body: "Asking questions is how we learn." },
        { title: "Integrity", body: "Doing the right thing, even when no one is watching." },
        { title: "Service", body: "Giving back to our community." },
      ], "plain"),
      k.info("Our facilities", ["Science and computer labs", "Library and reading room", "Playground and sports courts", "Art and music rooms", "Auditorium"], "Sample list: replace with your real facilities."),
      k.foot(),
    ]),
    page("page_admissions", "Admissions", "/admissions", seo("Admissions"), "How to apply, fees and important dates.", [
      k.nav(),
      k.hero("minimal", "Admissions", "A simple process in four steps."),
      k.steps("How to apply", [
        { title: "Enquire", body: "Fill the enquiry form or visit the school office." },
        { title: "Visit", body: "Tour the campus and meet the principal." },
        { title: "Interaction", body: "A friendly interaction with the child, not a test." },
        { title: "Enrol", body: "Submit documents and complete the fee payment." },
      ]),
      k.faq("Admission questions", [
        { question: "Is there an entrance test?", answer: "Sample answer: replace with your school's policy." },
        { question: "What are the school timings?", answer: "Sample answer: replace with your timings." },
        { question: "Is transport available?", answer: "Sample answer: replace with your transport details." },
      ]),
      k.info("Documents required", ["Birth certificate", "Previous report card (Class 2 onwards)", "Transfer certificate (if applicable)", "Passport-size photographs", "Address proof"]),
      k.cta("Ready to apply?", "Our office will guide you through every step.", "Contact admissions", "/contact"),
      k.foot(),
    ]),
    page("page_events", "Events", "/events", seo("Events"), "Annual day, sports day, science fair and more.", [
      k.nav(),
      k.hero("minimal", "School events", "Learning happens outside the classroom too."),
      k.grid("This year", [
        { title: "Annual Day", body: "Sample date: replace with your event date." },
        { title: "Sports Day", body: "Sample date: replace with your event date." },
        { title: "Science Fair", body: "Sample date: replace with your event date." },
        { title: "Parent-Teacher Meet", body: "Sample date: replace with your event date." },
      ]),
      k.foot(),
    ]),
    page("page_contact", "Contact", "/contact", seo("Contact"), "Contact the school office.", [
      k.nav(),
      ...k.contact("Contact the school", "Questions about admissions or a campus visit? We will reply within one working day.", "Send us a message", "Send message", ["Address: your street, your city", "Phone: +91 00000 00000", "Office hours: Mon-Sat, 8 am to 3 pm"]),
      k.foot(),
    ]),
  ]);
}
