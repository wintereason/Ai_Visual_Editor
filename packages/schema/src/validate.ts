import { STYLE_GROUPS, ProjectSchema, BREAKPOINTS, STYLE_STATES, type Node, type Project } from "./types";
import { canContain, getDef } from "./registry";

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: true; project: Project } | { ok: false; issues: ValidationIssue[] };

export function validateNode(node: Node, parentType: string | null, issues: ValidationIssue[], seen: Set<string>, path: string): void {
  if (seen.has(node.id)) issues.push({ path, message: `duplicate id "${node.id}"` });
  seen.add(node.id);

  const def = getDef(node.type);
  if (!def) {
    issues.push({ path, message: `unknown type "${node.type}"` });
    return;
  }
  if (def.kind !== node.kind) issues.push({ path, message: `type "${node.type}" must have kind "${def.kind}"` });

  if (parentType === null) {
    if (!def.topLevelOnly) issues.push({ path, message: `top-level nodes must be sections, got "${node.type}"` });
  } else if (!canContain(parentType, node.type)) {
    issues.push({ path, message: `"${node.type}" not allowed inside "${parentType}"` });
  }

  if (node.place && parentType !== "layerGroup") issues.push({ path, message: `"place" is only for layers directly inside a layerGroup` });

  const props = def.props.safeParse(node.props);
  if (!props.success) {
    for (const i of props.error.issues) issues.push({ path: `${path}.props.${i.path.join(".")}`, message: i.message });
  }

  if (node.variant !== undefined && !def.variants?.includes(node.variant)) {
    issues.push({ path, message: `variant "${node.variant}" not valid for "${node.type}"` });
  }
  if (node.animation && !def.animatable) issues.push({ path, message: `"${node.type}" does not support animation` });

  if (node.styles) {
    const allowed = new Set<string>(def.styleGroups.flatMap((g) => STYLE_GROUPS[g] as readonly string[]));
    for (const bp of BREAKPOINTS)
      for (const st of STYLE_STATES) {
        const s = node.styles[bp]?.[st];
        if (!s) continue;
        for (const key of Object.keys(s))
          if (!allowed.has(key)) issues.push({ path: `${path}.styles.${bp}.${st}.${key}`, message: `style "${key}" not supported by "${node.type}"` });
      }
  }

  if (node.children?.length) {
    if (def.children === "none") issues.push({ path, message: `"${node.type}" cannot have children` });
    node.children.forEach((c, i) => validateNode(c, node.type, issues, seen, `${path}.children[${i}]`));
  }
}

export function validateProject(input: unknown): ValidationResult {
  const parsed = ProjectSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };

  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const pagePaths = new Set<string>();
  parsed.data.pages.forEach((page, pi) => {
    if (seen.has(page.id)) issues.push({ path: `pages[${pi}]`, message: `duplicate id "${page.id}"` });
    seen.add(page.id);
    if (pagePaths.has(page.path)) issues.push({ path: `pages[${pi}]`, message: `duplicate page path "${page.path}"` });
    pagePaths.add(page.path);
    page.nodes.forEach((n, ni) => validateNode(n, null, issues, seen, `pages[${pi}].nodes[${ni}]`));
  });
  return issues.length ? { ok: false, issues } : { ok: true, project: parsed.data };
}
