import { describe, expect, it } from "vitest";
import { exampleProject, type Asset, type Project } from "@avc/schema";
import { buildSite, sha256Hex, type LibraryAsset } from "../src";

const dec = new TextDecoder();
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
async function lib(id: string): Promise<LibraryAsset> {
  const asset: Asset = { id, name: id, kind: "png", mime: "image/png", bytes: PNG.length, width: 1, height: 1, hash: await sha256Hex(PNG), createdAt: 1 };
  return { bytes: PNG, asset };
}
const withBrand = (): Project => {
  const p = structuredClone(exampleProject);
  p.brand = { name: "Secret Draft Name", colors: ["#123456", "#654321"], fonts: [{ heading: "Lora", body: "Inter" }] };
  return p;
};

describe("the brand kit and publishing", () => {
  it("saved swatches, saved fonts and the kit's name stay in the editor: they are not written into the site", async () => {
    const r = await buildSite(withBrand(), [], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const everything = Object.values(r.files).map((b) => dec.decode(b)).join("\n");
    expect(everything).not.toContain("#123456");
    expect(everything).not.toContain("#654321");
    expect(everything).not.toContain("Secret Draft Name");
  });

  it("a logo placed on a page is published like any picture, with its alt text", async () => {
    const p = withBrand();
    p.brand!.logoAssetId = "logo_1";
    p.pages[0]!.nodes[1]!.children!.push({ id: "logo", kind: "element", type: "image", props: { assetId: "logo_1", alt: "Bright School logo", fit: "contain" } });
    const r = await buildSite(p, [await lib("logo_1")], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec.decode(r.files["index.html"])).toContain('alt="Bright School logo"');
    expect(Object.keys(r.files).some((f) => f.startsWith("assets/"))).toBe(true);
  });

  it("a brand logo that was never placed on a page is not published", async () => {
    const p = withBrand();
    p.brand!.logoAssetId = "logo_1";
    const r = await buildSite(p, [await lib("logo_1")], { baseUrl: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.files).some((f) => f.startsWith("assets/"))).toBe(false);
  });
});
