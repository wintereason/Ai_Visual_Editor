import type { Project } from "@avc/schema";
import { coachingTemplate } from "./coaching";
import { collegeTemplate } from "./college";
import { onlineTemplate } from "./online";
import { preschoolTemplate } from "./preschool";
import { schoolTemplate } from "./school";
import { coachingAppTemplate, schoolAppTemplate } from "./apps";

export * from "./build";

export type TemplateMeta = {
  id: string;
  title: string;
  topic: "Education";
  description: string;
  /** Searchable keywords: look and feel, audience. */
  tags: string[];
  make: () => Project;
  /** Website templates are "web" (the default). App templates are "mobile": a phone-sized app with a tab bar. */
  platform?: "web" | "mobile";
};

export const TEMPLATES: TemplateMeta[] = [
  { id: "coaching", title: "Coaching Institute", topic: "Education", description: "Home, Courses, Teachers, Contact. Sample content to replace.", tags: ["blue", "coaching", "tuition", "exam prep", "professional"], make: coachingTemplate },
  { id: "school", title: "School", topic: "Education", description: "Home, About, Admissions, Events, Contact. Sample content to replace.", tags: ["green", "school", "admissions", "friendly"], make: schoolTemplate },
  { id: "college", title: "College", topic: "Education", description: "Home, Programs, Admissions, Campus life, Contact. Sample content to replace.", tags: ["maroon", "college", "university", "bold"], make: collegeTemplate },
  { id: "online", title: "Online Academy", topic: "Education", description: "Home, Courses, Pricing, Contact. Sample content to replace.", tags: ["purple", "online", "e-learning", "pricing", "modern"], make: onlineTemplate },
  { id: "preschool", title: "Preschool", topic: "Education", description: "Home, Programs, A day with us, Contact. Sample content to replace.", tags: ["teal", "preschool", "kids", "playful", "kindergarten"], make: preschoolTemplate },
];

/** Starter apps for the Mobile app project type. Kept apart from TEMPLATES, which is the pool pages can be mixed from. */
export const APP_TEMPLATES: TemplateMeta[] = [
  { id: "school-app", title: "School app", topic: "Education", platform: "mobile", description: "Home, Classes, Notices, Contact, with a bottom tab bar. Sample content to replace.", tags: ["green", "school", "parents", "app", "notices"], make: schoolAppTemplate },
  { id: "coaching-app", title: "Coaching app", topic: "Education", platform: "mobile", description: "Home, Batches, Results, Help, with a bottom tab bar. Sample content to replace.", tags: ["blue", "coaching", "students", "app", "batches"], make: coachingAppTemplate },
];

export * from "./mix";
export * from "./legal";
export * from "./platformLegal";
