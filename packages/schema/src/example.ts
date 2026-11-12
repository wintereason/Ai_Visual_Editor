import type { Project } from "./types";

export const exampleProject: Project = {
  schemaVersion: 2,
  id: "proj_example",
  name: "BrightPath Coaching",
  platform: "web",
  theme: {
    colors: {
      primary: "#2563EB", secondary: "#F59E0B", background: "#FFFFFF",
      surface: "#F3F4F6", text: "#111827", muted: "#6B7280",
    },
    fonts: { heading: "Poppins", body: "Inter" },
    radius: "md",
    motion: "subtle",
  },
  pages: [
    {
      id: "page_home",
      name: "Home",
      path: "/",
      seo: { title: "Home | BrightPath" },
      nodes: [
        {
          id: "sec_nav", kind: "container", type: "section", props: {},
          children: [
            { id: "nav1", kind: "block", type: "navbar", variant: "cta",
              props: { brand: "BrightPath", links: [{ label: "Courses", href: "/courses" }, { label: "Contact", href: "#contact" }], ctaLabel: "Enroll", ctaHref: "#contact" } },
          ],
        },
        {
          id: "sec_hero", kind: "container", type: "section", props: {},
          styles: { base: { normal: { padding: { top: "xl", bottom: "xl" } } }, mobile: { normal: { padding: { top: "md", bottom: "md" } } } },
          children: [
            { id: "hero1", kind: "block", type: "hero", variant: "split",
              props: { headline: "Learn skills that get you hired", subheadline: "Live classes, real projects", ctaLabel: "Start free trial", ctaHref: "#contact" },
              animation: { preset: "fade-in", trigger: "load" } },
          ],
        },
        {
          id: "sec_features", kind: "container", type: "section", props: {},
          children: [
            { id: "feat1", kind: "block", type: "featureGrid", variant: "cards",
              props: { title: "Why BrightPath", items: [
                { title: "Live mentors", body: "Learn from working professionals." },
                { title: "Projects", body: "Build a portfolio as you learn." },
                { title: "Placement help", body: "Interview prep and referrals." },
              ] } },
          ],
        },
        {
          id: "sec_footer", kind: "container", type: "section", props: {},
          children: [{ id: "foot1", kind: "block", type: "footer", variant: "simple", props: { copyright: "© BrightPath", links: [] } }],
        },
      ],
    },
  ],
};
