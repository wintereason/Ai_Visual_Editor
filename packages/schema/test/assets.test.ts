import { describe, expect, it } from "vitest";
import { collectAssetIds, exampleProject, fitWithin, lintProject, sniffImageType, type Project } from "../src";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("sniffImageType", () => {
  it("recognises real image headers", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a...."))).toBe("gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  });
  it("rejects scripts, SVG, HTML, empty and truncated input", () => {
    for (const s of ["<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "<html>", "#!/bin/sh", ""])
      expect(sniffImageType(new TextEncoder().encode(s))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
  });
});

describe("fitWithin", () => {
  it("downsizes the longest side, keeps ratio, never upscales", () => {
    expect(fitWithin(4800, 2400)).toEqual({ width: 2400, height: 1200 });
    expect(fitWithin(1000, 500)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin(1000, 4800).height).toBe(2400);
  });
});

describe("collectAssetIds + lint", () => {
  const proj = (): Project => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { assetId: "a1", alt: "x", fit: "cover" } });
    p.pages[0]!.nodes[1]!.children![0]!.props.imageAssetId = "a2";
    p.pages[0]!.nodes[2]!.styles = { base: { normal: { background: { assetId: "a3", fit: "cover" } } } };
    return p;
  };
  it("finds ids in props, hero images and background styles", () => {
    expect([...collectAssetIds(proj())].sort()).toEqual(["a1", "a2", "a3"]);
  });
  it("lint flags assets missing from the library only when a library is supplied", () => {
    expect(lintProject(proj()).some((i) => i.message.includes("media library"))).toBe(false);
    expect(lintProject(proj(), { assetIds: new Set(["a2"]) }).some((i) => i.message.includes("media library"))).toBe(true);
    // every asset the project uses (image, hero image AND background) must be in the library
    expect(lintProject(proj(), { assetIds: new Set(["a1"]) }).some((i) => i.message.includes("media library"))).toBe(true);
    expect(lintProject(proj(), { assetIds: new Set(["a1", "a2", "a3"]) }).some((i) => i.message.includes("media library"))).toBe(false);
  });
});
