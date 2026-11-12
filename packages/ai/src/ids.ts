import type { Node, Patch, PatchOp } from "@avc/schema";

/**
 * IDs chosen by a model must never be trusted to be unique (spec 9.9 item 6): it might reuse an id that already exists,
 * or two options might collide. Every node a model inserts gets a fresh id from `gen`, and every later reference to a
 * node inserted in the SAME patch (update / move / remove / parentId) is rewritten to match.
 */
export function freshenPatchIds(patch: Patch, gen: () => string): Patch {
  const map = new Map<string, string>();
  const reassign = (n: Node): Node => {
    const id = gen();
    map.set(n.id, id);
    return { ...n, id, children: n.children?.map(reassign) };
  };
  const ref = (id: string) => map.get(id) ?? id;

  const ops: PatchOp[] = patch.ops.map((op) => {
    switch (op.op) {
      case "insert": {
        const node = reassign(op.node);
        return { ...op, parentId: ref(op.parentId), node };
      }
      case "update": return { ...op, id: ref(op.id) };
      case "remove": return { ...op, id: ref(op.id) };
      case "move": return { ...op, id: ref(op.id), parentId: ref(op.parentId) };
      default: return op; // theme / page ops carry no node ids
    }
  });
  return { ...patch, ops };
}

export function freshenNodeIds(node: Node, gen: () => string): Node {
  return { ...node, id: gen(), children: node.children?.map((c) => freshenNodeIds(c, gen)) };
}
