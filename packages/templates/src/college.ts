import type { Project } from "@avc/schema";
import { makeIds, makeProject, page, siteKit } from "./build";

const BRAND = "Northbridge College";
const NAV = [
  { label: "Home", href: "/" },
  { label: "Programs", href: "/programs" },
  { label: "Admissions", href: "/admissions" },
  { label: "Campus life", href: "/campus" },
  { label: "Contact", href: "/contact" },
];

/** Sample copy only: programs, numbers and facilities are placeholders. */
export function collegeTemplate(): Project {
  const id = makeIds("g");
  const k = siteKit(id, BRAND, NAV, "Apply today", "/admissions");
  const seo = (t: string) => `${t} | ${BRAND}`;

  return makeProject("tpl_college", BRAND, { primary: "#9f1239", secondary: "#0ea5e9" }, "Montserrat", [
    page("page_home", "Home", "/", seo("Home"), "Undergraduate and postgraduate programs with strong placements and campus life.", [
      k.nav(),
      k.hero("split", "Build the career you want", "Industry-aligned programs, experienced faculty and a campus that supports you from day one.", "Explore programs", "/programs", true),
      k.stats("At a glance", [
        { value: "20+", label: "Programs (sample figure)" },
        { value: "90%", label: "Placement rate (sample figure)" },
        { value: "5,000", label: "Students (sample figure)" },
      ]),
      k.grid("Why study here", [
        { title: "Experienced faculty", body: "Teachers with academic and industry experience." },
        { title: "Practical learning", body: "Projects, internships and workshops in every program." },
        { title: "Scholarships", body: "Merit and need-based support for eligible students." },
        { title: "Student clubs", body: "Technical, cultural and sports clubs run by students." },
      ]),
      k.quotes("Student voices", ["The internship program gave me real experience before graduating.", "Student name", "Final-year student"], ["Faculty support made a big difference to my confidence.", "Alumni name", "Class of 2023"]),
      k.cta("Applications are open", "Start your application today."),
      k.foot(),
    ]),
    page("page_programs", "Programs", "/programs", seo("Programs"), "Undergraduate and postgraduate programs.", [
      k.nav(),
      k.hero("minimal", "Our programs", "Choose a path that matches your goals."),
      k.grid("Undergraduate", [
        { title: "B.Com", body: "Accounting, finance and business fundamentals." },
        { title: "B.Sc Computer Science", body: "Programming, data structures and software projects." },
        { title: "B.A. Economics", body: "Economic theory, data analysis and policy." },
        { title: "BBA", body: "Management, marketing and entrepreneurship." },
      ]),
      k.grid("Postgraduate", [
        { title: "M.Com", body: "Advanced accounting, taxation and research." },
        { title: "MBA", body: "General management with specialisations." },
        { title: "M.Sc Computer Science", body: "Advanced computing and applied projects." },
      ], "plain"),
      k.info("Duration and eligibility", ["Undergraduate: 3 years after Class 12", "Postgraduate: 2 years after graduation", "Eligibility varies by program"], "Sample details: replace with your own."),
      k.foot(),
    ]),
    page("page_admissions", "Admissions", "/admissions", seo("Admissions"), "How to apply, dates and fees.", [
      k.nav(),
      k.hero("minimal", "Admissions", "Apply in three simple steps."),
      k.steps("Process", [
        { title: "Apply online", body: "Submit the application form and upload documents." },
        { title: "Merit list", body: "Shortlisted candidates are published on this site." },
        { title: "Confirm seat", body: "Pay the fee and complete verification." },
      ]),
      k.info("Fees and scholarships", ["Fees are listed per program on the Programs page", "Merit scholarships for top scorers", "Need-based support: ask the admissions office"], "Sample content: replace with your policy."),
      k.cta("Questions about admissions?", "Our team is happy to help.", "Contact us", "/contact"),
      k.foot(),
    ]),
    page("page_campus", "Campus life", "/campus", seo("Campus life"), "Facilities, clubs and events on campus.", [
      k.nav(),
      k.hero("minimal", "Campus life", "More than classrooms."),
      k.grid("Facilities", [
        { title: "Library", body: "Books, journals and quiet study spaces." },
        { title: "Computer labs", body: "Modern machines and fast internet." },
        { title: "Hostel", body: "Separate hostels with meals and security." },
        { title: "Sports", body: "Grounds and indoor courts for multiple sports." },
        { title: "Cafeteria", body: "Affordable, hygienic meals." },
        { title: "Auditorium", body: "Venue for events, seminars and fests." },
      ]),
      k.foot(),
    ]),
    page("page_contact", "Contact", "/contact", seo("Contact"), "Contact admissions.", [
      k.nav(),
      ...k.contact("Contact admissions", "We reply within one working day.", "Send an enquiry", "Send enquiry", ["Address: your campus address", "Phone: +91 00000 00000", "Email: admissions@example.edu"]),
      k.foot(),
    ]),
  ]);
}
