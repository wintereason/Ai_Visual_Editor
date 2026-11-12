#!/usr/bin/env node
// After `next build`, prove that no server-only secret or credential has ended up in files served to browsers.
//   node scripts/check-secrets.mjs [dir]        (default: apps/editor/.next/static)
// Exits 1 and names the file if it finds one. Safe to run in CI.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? fileURLToPath(new URL("../apps/editor/.next/static", import.meta.url));

const RULES = [
  [/SUPABASE_SERVICE_ROLE_KEY/, "the name of the service-role key variable"],
  [/ANTHROPIC_API_KEY/, "the name of the AI key variable"],
  [/RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET/, "the name of a payment secret variable"],
  [/\bapply_payment\b/, "a server-only payments function name"],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, "an Anthropic API key"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "a Supabase secret key (new format)"],
  [/\bai_reserve\b|\bai_settle\b|\bgrant_credits\b/, "a server-only credits function name"],
];

// A real service-role key is a JWT whose payload says role=service_role. The bare word also appears in library comments
// (e.g. supabase-js: "Never expose your service_role key"), so look at what a token actually grants.
function hasServiceRoleJwt(text) {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}.(eyJ[A-Za-z0-9_-]{8,}).[A-Za-z0-9_-]{8,}/g)) {
    try { if (JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).role === "service_role") return true; } catch { /* not a JWT */ }
  }
  return false;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|css|html|json|map|txt)$/.test(name)) yield p;
  }
}

// The strongest check: the actual secret VALUES from the environment files must not appear in anything sent to browsers.
// Values are compared and never printed. Only variables WITHOUT the NEXT_PUBLIC_ prefix are treated as secret.
function secretValues() {
  const out = new Map();
  const add = (name, v) => { const c = String(v ?? "").trim().replace(/^["']|["']$/g, ""); if (c.length >= 16 && !/^NEXT_PUBLIC_/.test(name) && /KEY|SECRET|TOKEN|PASSWORD/i.test(name)) out.set(name, c); };
  for (const [k, v] of Object.entries(process.env)) add(k, v);
  for (const rel of ["../apps/editor/.env.local", "../apps/editor/.env", "../.env", "../.env.local"]) {
    try {
      for (const line of readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").split(/\r?\n/)) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
        if (m && !line.trim().startsWith("#")) add(m[1], m[2]);
      }
    } catch { /* file not present */ }
  }
  return out;
}
const secrets = secretValues();

let files = 0;
const bad = [];
try {
  for (const f of walk(root)) {
    files++;
    const text = readFileSync(f, "utf8");
    if (hasServiceRoleJwt(text)) bad.push(`${f.replace(root, "")}: contains a service-role JWT`);
    for (const [name, value] of secrets) if (text.includes(value)) bad.push(`${f.replace(root, "")}: contains the value of ${name}`);
    for (const [re, why] of RULES) if (re.test(text)) bad.push(`${f.replace(root, "")}: contains ${why}`);
  }
} catch (e) {
  console.error(`Could not read ${root}. Run a build first.`);
  process.exit(2);
}
if (files === 0) { console.error(`No built files found in ${root}.`); process.exit(2); }
if (bad.length) {
  console.error(`FOUND ${bad.length} problem(s) in files that are sent to browsers:\n - ` + bad.join("\n - "));
  process.exit(1);
}
console.log(`OK: scanned ${files} browser-facing files; no server-only secrets or credentials found (also checked for the actual values of ${secrets.size} secret setting(s)).`);
