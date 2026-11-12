#!/usr/bin/env node
// Smoke test against a REAL Supabase project, using only the public anon key (the same access the browser has).
//
//   node scripts/smoke-supabase.mjs run <emailA> <emailB>
//
// Works with Supabase's DEFAULT email sender and default templates: no custom SMTP, no {{ .Token }} edit.
// Run it in your own terminal (in Claude Code: type  ! node scripts/smoke-supabase.mjs run a@x.com b@y.com ):
//   1. It emails a magic link to each address.
//   2. For each one, open the email, RIGHT-CLICK the sign-in button, choose "Copy link address", and paste it here.
//      (Do not click the button: links are single-use, and this script redeems it for you.)
//      The paste is hidden, and the link/tokens are never printed or stored.
//   3. It then runs 25 checks as account A and account B (including 11 cross-account isolation checks), plus 12 more
//      for sites and public form submissions if migration 2 has been applied (skipped with a notice if not).
//   4. Everything it created is deleted afterwards and both test sessions are revoked.
//
// Use two throwaway or test addresses you control. A brand-new address receives a "Confirm signup" email instead of a
// "Magic Link" email; the link in either one works here.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { MagicLinkError, redeemMagicLink } from "./magic-link.mjs";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

/**
 * Exit without crashing. On Windows, calling await quit() while a network connection is still closing aborts Node with
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Setting the exit code and waiting a moment avoids it.
 */
const quit = async (code) => {
  process.exitCode = code;
  await new Promise((r) => setTimeout(r, 300));
  process.exit(code);
};

const envPath = fileURLToPath(new URL("../apps/editor/.env.local", import.meta.url));
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY || URL_.includes("YOUR-PROJECT")) {
  console.error("apps/editor/.env.local is missing a real NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  await quit(2);
}
const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const [cmd, ...args] = process.argv.slice(2);
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

if (cmd !== "run" || args.length !== 2 || !args.every((a) => emailRe.test(a)) || args[0].toLowerCase() === args[1].toLowerCase()) {
  console.error("usage: node scripts/smoke-supabase.mjs run <emailA> <emailB>   (two different addresses)");
  await quit(2);
}
if (!process.stdin.isTTY) {
  console.error(
    "This script asks you to paste links, so it must run in an interactive terminal.\n" +
      "In Claude Code, type:  ! node scripts/smoke-supabase.mjs run " + args.join(" "),
  );
  await quit(2);
}

// ---------- tiny test harness ----------
let pass = 0;
let fail = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
};
const brief = (e) => (e ? `${e.code ?? e.statusCode ?? ""} ${String(e.message ?? e).slice(0, 110)}`.trim() : "no error");

/** Prompt with the typed/pasted text hidden (shown as *), so a pasted link never appears on screen or in scrollback. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;
    rl._writeToOutput = (s) => process.stdout.write(answered || s === question ? s : s.replace(/[^\r\n]/g, "*").slice(0, 1));
    rl.on("close", () => (answered ? undefined : reject(new Error("Input closed before a link was pasted."))));
    rl.question(question, (ans) => {
      answered = true;
      rl.close();
      process.stdout.write("\n");
      resolve(ans);
    });
  });
}

/**
 * Sign in one test account through the DEFAULT magic-link email, with the user pasting the link.
 * Returns an authenticated client held in memory only; nothing is persisted.
 */
async function login(label, email) {
  const c = client();
  const sent = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (sent.error) {
    const rate = /rate limit|seconds|too many/i.test(sent.error.message);
    console.error(
      rate
        ? `Supabase's built-in email sender is rate limited (${sent.error.message}). Wait a while (up to an hour) and run again.`
        : `Could not send the email to ${email}: ${sent.error.message}`,
    );
    await quit(1);
  }
  console.log(`\n[${label}] Email sent to ${email}. It can take a minute (check spam too).`);
  console.log("      Open it, RIGHT-CLICK the sign-in button, choose 'Copy link address' (don't click it), then paste below.");

  for (let attempt = 1; attempt <= 3; attempt++) {
    let tokens;
    try {
      tokens = await redeemMagicLink(await askHidden(`[${label}] Paste link (hidden): `), URL_);
    } catch (e) {
      if (!(e instanceof MagicLinkError)) throw e;
      console.log(`      ${e.message}`);
      if (attempt === 3) await quit(1);
      continue;
    }
    const { data, error } = await c.auth.setSession(tokens);
    if (error || !data.user) {
      console.log("      Supabase did not accept that session. Request a new link and try again.");
      if (attempt === 3) await quit(1);
      continue;
    }
    if ((data.user.email ?? "").toLowerCase() !== email.toLowerCase()) {
      // Guards against pasting account B's link at account A's prompt, which would silently void the isolation checks.
      await c.auth.signOut({ scope: "local" });
      console.log(`      That link signed in a different account than ${email}. Paste the link from the email sent to ${email}.`);
      if (attempt === 3) await quit(1);
      continue;
    }
    console.log(`      Signed in as ${email}.`);
    return { c, id: data.user.id, email };
  }
}

const doc = (name) => ({
  schemaVersion: 2, id: "p", name, platform: "web",
  theme: { colors: { primary: "#2563EB", secondary: "#F59E0B", background: "#FFFFFF", surface: "#F3F4F6", text: "#111827", muted: "#6B7280" }, fonts: { heading: "Poppins", body: "Inter" }, radius: "md", motion: "subtle" },
  pages: [{ id: "pg", name: "Home", path: "/", nodes: [] }],
});
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const stamp = Date.now().toString(36);

function askPlain(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on("close", () => (answered ? undefined : reject(new Error("Input closed."))));
    rl.question(question, (ans) => {
      answered = true;
      rl.close();
      resolve(ans);
    });
  });
}

console.log("\nThis will email a sign-in link to BOTH addresses:");
console.log(`   A: ${args[0]}`);
console.log(`   B: ${args[1]}`);
console.log("Both must be inboxes YOU can open right now. Supabase's free email sender allows only about 2 emails per hour,");
console.log("so a wrong address wastes your quota and means waiting an hour.");
const sure = (await askPlain("Type yes to send, anything else to cancel: ")).trim().toLowerCase();
if (sure !== "yes") {
  console.log("Cancelled. Nothing was sent.");
  await quit(0);
}

const A = await login("A", args[0]);
const B = await login("B", args[1]);
if (A.id === B.id) {
  console.error("Both links signed in the same account. Use two different email addresses.");
  await quit(2);
}
console.log(`\nSigned in as A (${A.email}) and B (${B.email}). Running checks...\n`);

const cleanup = { projects: [], assets: [], objects: [] };

try {
  console.log("Projects (account A)");
  const created = await A.c.from("projects").insert({ owner_id: A.id, name: `smoke-${stamp}`, platform: "web", json: doc("v1") }).select("id, version").single();
  check("create a project", !created.error && created.data?.version === 1, brief(created.error));
  const pid = created.data?.id;
  if (pid) cleanup.projects.push(pid);

  const read = await A.c.from("projects").select("id, name, version").eq("id", pid).single();
  check("read it back", read.data?.name === `smoke-${stamp}`, brief(read.error));

  const s1 = await A.c.rpc("save_project", { p_id: pid, p_base_version: 1, p_json: doc("v2"), p_name: `smoke-${stamp}` });
  check("save from version 1 -> version 2", s1.data?.[0]?.version === 2, brief(s1.error));
  const stale = await A.c.rpc("save_project", { p_id: pid, p_base_version: 1, p_json: doc("stale"), p_name: null });
  check("a stale save is rejected as a conflict (40001)", stale.error?.code === "40001", brief(stale.error));
  const after = await A.c.from("projects").select("json, version").eq("id", pid).single();
  check("the stale save changed nothing", after.data?.version === 2 && after.data?.json?.name === "v2", JSON.stringify(after.data?.version));

  const bad = await A.c.from("projects").insert({ owner_id: A.id, name: "bad", platform: "web", json: { hello: "world" } });
  check("a document with no schemaVersion is rejected", !!bad.error, brief(bad.error));
  const spoof = await A.c.from("projects").insert({ owner_id: B.id, name: "spoof", platform: "web", json: doc("x") });
  check("cannot create a project owned by someone else", !!spoof.error, brief(spoof.error));

  const snap = await A.c.rpc("snapshot_project", { p_id: pid, p_reason: "smoke" });
  check("snapshot works", !snap.error, brief(snap.error));
  const vers = await A.c.from("project_versions").select("version, reason").eq("project_id", pid);
  check("snapshot is listed", vers.data?.length === 1 && vers.data[0].reason === "smoke", brief(vers.error));

  console.log("\nMedia (account A)");
  const hash = [...stamp].map((c) => c.charCodeAt(0).toString(16)).join("").padEnd(64, "0").slice(0, 64);
  const assetId = `asset_${hash.slice(0, 24)}`;
  const key = `${A.id}/${assetId}`;
  const up = await A.c.storage.from("assets").upload(key, PNG, { contentType: "image/png" });
  check("upload an image to my own folder", !up.error, brief(up.error));
  if (!up.error) cleanup.objects.push(key);
  const meta = await A.c.from("assets").insert({ id: assetId, owner_id: A.id, name: "smoke", kind: "png", mime: "image/png", bytes: PNG.length, width: 1, height: 1, hash, storage_key: key });
  check("record its metadata", !meta.error, brief(meta.error));
  if (!meta.error) cleanup.assets.push(assetId);
  const dl = await A.c.storage.from("assets").download(key);
  const got = dl.data ? new Uint8Array(await dl.data.arrayBuffer()) : null;
  check("download returns identical bytes", !!got && got.length === PNG.length && got.every((b, i) => b === PNG[i]), brief(dl.error));
  const txt = await A.c.storage.from("assets").upload(`${A.id}/smoke-${stamp}.txt`, new Blob(["hello"], { type: "text/plain" }), { contentType: "text/plain" });
  check("non-image MIME types are refused by the bucket", !!txt.error, brief(txt.error));
  if (!txt.error) cleanup.objects.push(`${A.id}/smoke-${stamp}.txt`);
  const wrongKey = await A.c.from("assets").insert({ id: `asset_x${stamp}`, owner_id: A.id, name: "x", kind: "png", mime: "image/png", bytes: 1, width: 1, height: 1, hash: "a".repeat(64), storage_key: `${B.id}/asset_x${stamp}` });
  check("metadata pointing into someone else's folder is rejected", !!wrongKey.error, brief(wrongKey.error));

  console.log("\nIsolation (account B must see and touch nothing of A's)");
  const bList = await B.c.from("projects").select("id").eq("id", pid);
  check("B cannot read A's project", !bList.error && bList.data?.length === 0, brief(bList.error));
  const bAll = await B.c.from("projects").select("id");
  check("B's project list does not include A's", !bAll.data?.some((r) => r.id === pid));
  const bSave = await B.c.rpc("save_project", { p_id: pid, p_base_version: 2, p_json: doc("hijack"), p_name: null });
  check("B cannot save over A's project (looks like not-found, P0002)", bSave.error?.code === "P0002", brief(bSave.error));
  const bUpd = await B.c.from("projects").update({ name: "pwned" }).eq("id", pid).select();
  check("B cannot rename A's project", !bUpd.error && bUpd.data?.length === 0, brief(bUpd.error));
  const bDel = await B.c.from("projects").delete().eq("id", pid).select();
  check("B cannot delete A's project", !bDel.error && bDel.data?.length === 0, brief(bDel.error));
  const bVers = await B.c.from("project_versions").select("id").eq("project_id", pid);
  check("B cannot read A's version history", bVers.data?.length === 0, brief(bVers.error));
  const bAssets = await B.c.from("assets").select("id").eq("id", assetId);
  check("B cannot read A's asset record", bAssets.data?.length === 0, brief(bAssets.error));
  const bDl = await B.c.storage.from("assets").download(key);
  check("B cannot download A's file", !!bDl.error && !bDl.data, brief(bDl.error));
  const bUp = await B.c.storage.from("assets").upload(`${A.id}/planted-${stamp}.png`, PNG, { contentType: "image/png" });
  check("B cannot write into A's storage folder", !!bUp.error, brief(bUp.error));
  if (!bUp.error) cleanup.objects.push(`${A.id}/planted-${stamp}.png`);
  const bRm = await B.c.storage.from("assets").remove([key]);
  const still = await A.c.storage.from("assets").download(key);
  check("B cannot delete A's file (it is still there)", !!still.data, `remove returned ${bRm.data?.length ?? 0} item(s); ${brief(still.error)}`);
  const bList2 = await B.c.storage.from("assets").list(A.id);
  check("B cannot list A's folder", !bList2.error ? (bList2.data?.length ?? 0) === 0 : true, brief(bList2.error));

  // ---------- migration 2: sites and public form submissions (skipped cleanly if it has not been applied) ----------
  console.log("\nSites and forms (migration 2)");
  const probe = await A.c.from("sites").select("id").limit(1);
  const notApplied = !!probe.error && /PGRST205|42P01|schema cache|does not exist/i.test(`${probe.error.code} ${probe.error.message}`);
  if (notApplied) {
    console.log("  SKIP  migration 2 is not applied to this project yet (supabase/migrations/20250102000000_sites_forms_derived.sql)");
  } else {
    const anon = client(); // no session: exactly what a visitor of a published site has
    const slug = `smoke-${stamp}`;
    const mine = await A.c.from("sites").insert({ owner_id: A.id, project_id: pid, slug }).select("id").single();
    check("create a site for my own project", !mine.error && !!mine.data?.id, brief(mine.error));
    const siteId = mine.data?.id;

    const squat = await B.c.from("sites").insert({ owner_id: B.id, project_id: pid, slug: `${slug}-b` });
    check("B cannot attach a site to A's project", !!squat.error, brief(squat.error));
    const badSlug = await A.c.from("sites").insert({ owner_id: A.id, project_id: pid, slug: "Bad Slug!" });
    check("an invalid site address is rejected", !!badSlug.error, brief(badSlug.error));

    const visitor = await anon.rpc("submit_form", { p_site_slug: slug, p_form_id: "contact", p_fields: { name: "Smoke Test", message: "hello" }, p_honeypot: null });
    check("a visitor with no account can submit a form", !visitor.error && visitor.data?.ok === true, brief(visitor.error));
    const typed = await anon.rpc("submit_form", { p_site_slug: slug, p_form_id: "contact", p_fields: { age: 7 }, p_honeypot: null });
    check("a malformed submission is rejected", typed.error?.code === "22023", brief(typed.error));
    const missing = await anon.rpc("submit_form", { p_site_slug: `nope-${stamp}`, p_form_id: "contact", p_fields: { a: "b" }, p_honeypot: null });
    check("a submission to an unknown site is refused (not found)", missing.error?.code === "P0002", brief(missing.error));
    const bot = await anon.rpc("submit_form", { p_site_slug: slug, p_form_id: "contact", p_fields: { name: "Bot" }, p_honeypot: "http://spam.example" });
    check("a filled honeypot looks successful to the bot", !bot.error && bot.data?.ok === true, brief(bot.error));

    const owner = await A.c.from("form_submissions").select("payload").eq("site_id", siteId);
    check("the owner sees exactly the one real submission (the bot's was dropped)", owner.data?.length === 1 && owner.data[0].payload?.name === "Smoke Test", brief(owner.error));
    const other = await B.c.from("form_submissions").select("id").eq("site_id", siteId);
    check("B cannot read A's submissions", !other.error && other.data?.length === 0, brief(other.error));
    const anonRead = await anon.from("form_submissions").select("id");
    check("a visitor cannot read any submissions", !!anonRead.error || anonRead.data?.length === 0, brief(anonRead.error));
    const anonWrite = await anon.from("form_submissions").insert({ site_id: siteId, form_id: "x", payload: { a: "forged" } });
    check("a visitor cannot write submissions directly (only through the form function)", !!anonWrite.error, brief(anonWrite.error));
    const otherDel = await B.c.from("form_submissions").delete().eq("site_id", siteId).select();
    check("B cannot delete A's submissions", !otherDel.error && otherDel.data?.length === 0, brief(otherDel.error));
  }

  // ---------- migration 6: sharing (skipped cleanly if it has not been applied) ----------
  console.log("\nSharing (migration 6)");
  const sharingProbe = await B.c.rpc("claim_invites");
  if (sharingProbe.error && /PGRST202|42883|schema cache|does not exist/i.test(`${sharingProbe.error.code} ${sharingProbe.error.message}`)) {
    console.log("  SKIP  migration 6 is not applied to this project yet (supabase/migrations/20250106000000_collaboration.sql)");
  } else {
    const anon2 = client();
    const readable = async (who) => (await who.c.from("projects").select("id").eq("id", pid)).data?.length ?? 0;
    const sv = async (who, base, name) => who.c.rpc("save_project", { p_id: pid, p_base_version: base, p_json: doc(name), p_name: null });

    check("before any invitation, B can't see A's project", (await readable(B)) === 0);
    const inv = await A.c.rpc("share_project", { p_project: pid, p_email: B.email, p_role: "viewer" });
    check("A invites B as a viewer", !inv.error, brief(inv.error));
    check("an invitation alone gives B no access", (await readable(B)) === 0);
    const selfShare = await A.c.rpc("share_project", { p_project: pid, p_email: A.email, p_role: "editor" });
    check("A cannot share with themself", !!selfShare.error, brief(selfShare.error));
    const badRole = await A.c.rpc("share_project", { p_project: pid, p_email: B.email, p_role: "owner" });
    check("a role other than editor/viewer is refused", !!badRole.error, brief(badRole.error));
    const bShare = await B.c.rpc("share_project", { p_project: pid, p_email: "someone-else@example.com", p_role: "editor" });
    check("B cannot share A's project with anyone", !!bShare.error, brief(bShare.error));

    const claimed = await B.c.rpc("claim_invites");
    check("B accepts the invitation by signing in (claim)", !claimed.error && claimed.data >= 1, brief(claimed.error) || JSON.stringify(claimed.data));
    check("B can now read the project", (await readable(B)) === 1);
    const list = await B.c.rpc("shared_with_me");
    check("it appears in B's 'shared with me' list as a viewer", list.data?.some((r) => r.id === pid && r.role === "viewer"), brief(list.error));
    const role1 = await B.c.rpc("project_role", { p_project: pid });
    check("B's role is viewer", role1.data === "viewer", String(role1.data));

    const viewerSave = await sv(B, 2, "viewer-hack");
    check("a viewer's save is refused (read_only), not shown as a conflict", /read_only/.test(viewerSave.error?.message ?? ""), brief(viewerSave.error));
    const viewerDirect = await B.c.from("projects").update({ name: "hacked" }).eq("id", pid).select();
    check("a viewer can't change the project directly either", !viewerDirect.error && viewerDirect.data?.length === 0, brief(viewerDirect.error));
    const viewerDelete = await B.c.from("projects").delete().eq("id", pid).select();
    check("a viewer can't delete it", !viewerDelete.error && viewerDelete.data?.length === 0, brief(viewerDelete.error));
    const people = await B.c.rpc("project_people", { p_project: pid });
    check("a member can't list who else has access", !!people.error, brief(people.error));
    const ownerPeople = await A.c.rpc("project_people", { p_project: pid });
    check("the owner can, and sees B as a member", ownerPeople.data?.some((r) => r.kind === "member" && String(r.email).toLowerCase() === String(B.email).toLowerCase()), brief(ownerPeople.error));

    await A.c.rpc("share_project", { p_project: pid, p_email: B.email, p_role: "editor" });
    await B.c.rpc("claim_invites");
    const role2 = await B.c.rpc("project_role", { p_project: pid });
    check("re-sharing as editor takes effect when B next claims", role2.data === "editor", String(role2.data));
    const e1 = await sv(B, 2, "edited-by-b");
    check("an editor can save", e1.data?.[0]?.version === 3, brief(e1.error));
    const e2 = await sv(A, 2, "stale-from-a");
    check("A saving from an older version gets a conflict (nobody is overwritten)", e2.error?.code === "40001", brief(e2.error));
    const takeover = await B.c.from("projects").update({ owner_id: B.id }).eq("id", pid).select();
    check("an editor can't take the project over", !!takeover.error || takeover.data?.length === 0, brief(takeover.error));
    const eDelete = await B.c.from("projects").delete().eq("id", pid).select();
    check("an editor can't delete it", !eDelete.error && eDelete.data?.length === 0, brief(eDelete.error));
    const eSite = await B.c.from("sites").select("id").eq("project_id", pid);
    check("an editor can't see the site or inbox settings", !eSite.error && eSite.data?.length === 0, brief(eSite.error));

    const unshare = await A.c.rpc("unshare_project", { p_project: pid, p_user: B.id, p_email: null });
    check("A removes B", !unshare.error, brief(unshare.error));
    check("B loses access at once", (await readable(B)) === 0);

    const anonCalls = await Promise.all([anon2.rpc("claim_invites"), anon2.rpc("shared_with_me"), anon2.rpc("project_role", { p_project: pid })]);
    check("a signed-out visitor can call none of the sharing functions", anonCalls.every((r) => !!r.error), anonCalls.map((r) => brief(r.error)).join(" | "));
  }
} finally {
  console.log("\nCleaning up test data...");
  if (cleanup.objects.length) await A.c.storage.from("assets").remove(cleanup.objects).catch(() => {});
  for (const id of cleanup.assets) await A.c.from("assets").delete().eq("id", id).catch(() => {});
  for (const id of cleanup.projects) await A.c.from("projects").delete().eq("id", id).catch(() => {}); // versions cascade
  const left = await A.c.from("projects").select("id").like("name", `smoke-${stamp}`);
  console.log(left.data?.length ? `WARNING: ${left.data.length} test project(s) remain` : "Clean.");
  // Revoke the two test sessions server-side (scope "local" = only these sessions, not any other login of the same email).
  await A.c.auth.signOut({ scope: "local" }).catch(() => {});
  await B.c.auth.signOut({ scope: "local" }).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failed:\n - " + failures.join("\n - "));
await quit(fail ? 1 : 0);
