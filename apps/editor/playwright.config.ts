import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/warmup.ts",
  timeout: 30_000,
  // One single-threaded dev server serves every worker; fewer parallel workers keeps response times (and so test timing) steady
  // on a busy machine. Raise it on a quiet one.
  workers: 4,
  // Assertions poll until true; a longer window rides out multi-second browser stalls on a loaded machine without hiding real failures.
  expect: { timeout: 10_000 },
  use: { baseURL: "http://localhost:3100", viewport: { width: 1400, height: 900 } },
  webServer: [
    // A fake Anthropic API (slow on purpose, so live progress is observable). The editor talks to it through the real route and provider code.
    { command: "node e2e/fake-anthropic.mjs", url: "http://127.0.0.1:3198/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "node e2e/fake-cloudflare-server.mjs", url: "http://127.0.0.1:3197/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "node e2e/fake-razorpay.mjs", url: "http://127.0.0.1:3196/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "npx next dev -p 3100", url: "http://localhost:3100", reuseExistingServer: false, timeout: 120_000, env: { NEXT_PUBLIC_CLOUD: "mock", ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:3198", AI_MODEL: "fake-model", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6ImFiYyJ9.signaturesignature", AI_RATE_PER_MINUTE: "1000", SUPABASE_SERVICE_ROLE_KEY: "", CLOUDFLARE_API_BASE: "http://127.0.0.1:3197/client/v4", PUBLISH_RATE_PER_MINUTE: "1000", BILLING_RATE_PER_MINUTE: "1000", RAZORPAY_KEY_ID: "rzp_test_e2e12345", RAZORPAY_KEY_SECRET: "e2e_key_secret_0123456789", RAZORPAY_WEBHOOK_SECRET: "e2e_webhook_secret_abcdef", RAZORPAY_API_BASE: "http://127.0.0.1:3196/v1" /* tests never use real credentials, even if .env.local has them */ } },
  ],
});
