export class MagicLinkError extends Error {}
export function parseMagicLink(link: unknown, projectUrl: string): URL;
export function redirectParams(location: string, base: string): URLSearchParams;
export function redeemMagicLink(
  link: unknown,
  projectUrl: string,
  fetchImpl?: (input: URL, init: { redirect: "manual" }) => Promise<{ status: number; headers: { get(name: string): string | null } }>,
): Promise<{ access_token: string; refresh_token: string }>;
