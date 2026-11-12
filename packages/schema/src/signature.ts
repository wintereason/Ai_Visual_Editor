import type { Node, Page } from "./types";

// Spec 10.3: ordered structure only (id, type, variant); text, images, animation and styles are excluded.
function nodeSig(n: Node): string {
  return `${n.id}|${n.type}|${n.variant ?? ""}(${(n.children ?? []).map(nodeSig).join(",")})`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function structureSignature(page: Page): string {
  return fnv1a(page.nodes.map(nodeSig).join(";"));
}
