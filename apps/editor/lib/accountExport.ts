import type { CloudAdapter } from "@avc/cloud";
import { strToU8, zipSync } from "fflate";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";

export type AccountExport = { bytes: Uint8Array; projects: number; media: number; messages: number; problems: string[] };

/**
 * Everything a person has in their account, as one .zip they can keep: each project as JSON, every media file, and any
 * contact-form messages. Reads only what the signed-in person can already read. A file that can't be fetched is listed in
 * the README instead of silently dropped, and does not stop the rest.
 */
export async function buildAccountExport(cloud: CloudAdapter, now: Date = new Date()): Promise<AccountExport> {
  const files: Record<string, Uint8Array> = {};
  const problems: string[] = [];
  const user = await cloud.user();

  const projects = await cloud.listProjects();
  const messages: Record<string, unknown> = {};
  let messageCount = 0;
  for (const p of projects) {
    try {
      const loaded = await cloud.loadProject(p.id);
      files[`projects/${safeName(p.name)}-${p.id}.json`] = strToU8(JSON.stringify(loaded.project, null, 2));
    } catch {
      problems.push(`Project "${p.name}" could not be read.`);
      continue;
    }
    try {
      const site = await cloud.getSite(p.id);
      if (site) {
        const subs = await cloud.listSubmissions(p.id);
        messages[p.id] = { project: p.name, site: site.slug, messages: subs };
        messageCount += subs.length;
      }
    } catch {
      problems.push(`Messages for "${p.name}" could not be read.`);
    }
  }

  const assets = await cloud.listAssets();
  let mediaCount = 0;
  for (const a of assets) {
    try {
      const blob = await cloud.downloadAsset(a);
      files[`media/${a.id}.${EXT[a.mime] ?? "bin"}`] = new Uint8Array(await blob.arrayBuffer());
      mediaCount++;
    } catch {
      problems.push(`Media file "${a.name}" (${a.id}) could not be downloaded.`);
    }
  }
  files["media.json"] = strToU8(JSON.stringify(assets, null, 2));
  if (messageCount > 0 || Object.keys(messages).length) files["messages.json"] = strToU8(JSON.stringify(messages, null, 2));

  files["README.txt"] = strToU8([
    "Your data export",
    `Account: ${user?.email ?? "unknown"}`,
    `Exported: ${now.toISOString()}`,
    "",
    `projects/   ${projects.length} project file(s), as JSON. Each is a complete project you can re-import.`,
    `media/      ${mediaCount} of ${assets.length} image file(s). media.json describes each one (name, size, alt text).`,
    `messages.json  ${messageCount} contact-form message(s), if you have a published site.`,
    ...(problems.length ? ["", "Some items could not be included:", ...problems.map((x) => `  - ${x}`)] : []),
    "",
  ].join("\n"));

  return { bytes: zipSync(files), projects: projects.length, media: mediaCount, messages: messageCount, problems };
}
