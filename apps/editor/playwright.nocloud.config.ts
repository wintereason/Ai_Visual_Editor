import { defineConfig } from "@playwright/test";

// Local-only mode: no backend configured. The cloud UI must be completely absent.
export default defineConfig({
  testDir: "./e2e-nocloud",
  use: { baseURL: "http://localhost:3101", viewport: { width: 1400, height: 900 } },
  webServer: { command: "npx next dev -p 3101", url: "http://localhost:3101", reuseExistingServer: false, timeout: 120_000, env: { NEXT_PUBLIC_CLOUD: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", ANTHROPIC_API_KEY: "" } },
});
