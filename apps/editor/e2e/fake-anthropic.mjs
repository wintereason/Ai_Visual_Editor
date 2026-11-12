// A tiny stand-in for the Anthropic Messages API, for browser tests only. It is deliberately slow (so live progress can be
// observed) and deterministic. It recognises which agent is asking from the first user message.
import { createServer } from "node:http";

const DELAY = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nav = (id) => ({ id, kind: "container", type: "section", props: {}, children: [{ id: id + "n", kind: "block", type: "navbar", variant: "cta", props: { brand: "Demo", links: [{ label: "Home", href: "/" }], ctaLabel: "Go", ctaHref: "#c" } }] });
const hero = (id, h) => ({ id, kind: "container", type: "section", props: {}, children: [{ id: id + "h", kind: "block", type: "hero", variant: "split", props: { headline: h, subheadline: "Placeholder", ctaLabel: "Start", ctaHref: "#c" } }] });
const foot = (id) => ({ id, kind: "container", type: "section", props: {}, children: [{ id: id + "f", kind: "block", type: "footer", variant: "simple", props: { copyright: "© Demo", links: [] } }] });

const layout = {
  name: "Demo School",
  theme: {
    colors: { primary: "#2563EB", secondary: "#F59E0B", background: "#FFFFFF", surface: "#F3F4F6", text: "#111827", muted: "#6B7280" },
    fonts: { heading: "Poppins", body: "Inter" }, radius: "md", motion: "subtle",
  },
  pages: [
    { name: "Home", path: "/", seo: { title: "Home", description: "Home page" }, nodes: [nav("a1"), hero("a2", "Welcome"), foot("a3")] },
    { name: "About", path: "/about", seo: { title: "About", description: "About page" }, nodes: [nav("b1"), hero("b2", "About us"), foot("b3")] },
  ],
};

const seen = new Set();

const server = createServer(async (req, res) => {
  if (req.url === "/health") { res.end("ok"); return; }
  if (req.url === "/debug/last-style") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(globalThis.__lastStyle ?? null)); return; }
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) { res.statusCode = 404; res.end(); return; }
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const first = String(body.messages?.[0]?.content ?? "");
  const retry = body.messages.length > 1;
  // The safety classifier (a separate, small request): answers "flagged" only for a marker phrase, so tests can trigger it.
  if (String(body.system ?? "").includes("content-safety classifier")) {
    const text = body.messages.map((m) => String(m.content)).join(" ");
    const flagged = text.includes("FORBIDDEN-TEST-CONTENT");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "msg_mod", type: "message", role: "assistant", model: "fake-model", content: [{ type: "text", text: JSON.stringify({ flagged, categories: flagged ? ["illegal"] : [] }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }));
    return;
  }
  // A style request: the first message holds an image block plus text.
  if (Array.isArray(body.messages?.[0]?.content) && body.messages[0].content.some((p) => p.type === "image")) {
    const text = body.messages[0].content.filter((p) => p.type === "text").map((p) => p.text).join(" ");
    const hasImage = body.messages[0].content.find((p) => p.type === "image");
    await sleep(DELAY);
    let out;
    if (text.includes("BADSTYLE") && !retry) out = "I like this picture a lot!";
    else out = JSON.stringify({ notes: "Warm and friendly, with rounded shapes and a purple accent.", theme: { colors: { primary: "#6d28d9", secondary: "#f59e0b", background: "#fffbf5", surface: "#f5efe6", text: "#1f2937", muted: "#4b5563" }, fonts: { heading: "Lora", body: "Inter" }, radius: "lg", motion: "subtle" } });
    // let tests see what really arrived
    if (hasImage) globalThis.__lastStyle = { mediaType: hasImage.source.media_type, bytes: Buffer.from(hasImage.source.data, "base64").length, magic: Buffer.from(hasImage.source.data, "base64").subarray(0, 3).toString("hex") };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "msg_style", type: "message", role: "assistant", model: "fake-model", content: [{ type: "text", text: out }], stop_reason: "end_turn", usage: { input_tokens: 1500, output_tokens: 150 } }));
    return;
  }
  await sleep(DELAY);

  let text = "{}";
  if (first.includes("Plan the website")) {
    if (first.includes("BADLAYOUT") && !retry) text = "this is not json";
    else text = JSON.stringify(layout);
  } else if (first.includes("Write the real content")) {
    const name = /the page "([^"]*)"/.exec(first)?.[1] ?? "";
    const nodes = JSON.parse(/<page>\n([\s\S]*?)\n<\/page>/.exec(first)[1]);
    // First try for a page of a "FLAKY" brief returns garbage; the retry (which carries the validator's feedback) is fine.
    const key = first.slice(0, 400) + name;
    if (first.includes("FLAKY") && name === "About" && !retry && !seen.has(key)) { seen.add(key); text = "I cannot do that"; }
    else if (first.includes("ALWAYSFAIL") && name === "About") text = "still not json";
    else {
      const walk = (ns) => ns.forEach((n) => { if (n.type === "hero") n.props.headline = `Written for ${name}`; if (n.children) walk(n.children); });
      walk(nodes);
      text = JSON.stringify({ nodes });
    }
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ id: "msg_fake", type: "message", role: "assistant", model: "fake-model", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } }));
});

server.listen(3198, "127.0.0.1", () => console.log("fake anthropic on 3198"));
