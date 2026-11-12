export type FakeCloudflare = {
  state: {
    projects: Map<string, { name: string; subdomain: string }>;
    store: Map<string, { value: string; contentType: string }>;
    upserted: Set<string>;
    deployments: Map<string, { project: string; manifest: Record<string, string>; files: Record<string, string>; polls: number; wrongKeys: string[] }>;
    domains: Map<string, { project: string; polls: number }>; uploadCalls: number; uploadedKeys: string[]; tokenCalls: number; jwts: Set<string>; log: string[]; seq: number;
  };
  api(req: Request): Promise<Response>;
  site(id: string, path: string): Response;
  fetch: typeof fetch;
  options: { accountId: string; token: string; siteBase: string | null; expireJwtAfterUploads: number; deployPolls: number; domainActivatePolls: number; apexNeedsZone: boolean };
};
export function createFakeCloudflare(opts?: Partial<{ accountId: string; token: string; siteBase: string | null; expireJwtAfterUploads: number; deployPolls: number; domainActivatePolls: number; apexNeedsZone: boolean }>): FakeCloudflare;
