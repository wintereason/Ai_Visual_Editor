import { defineConfig } from "vitest/config";

// The live evaluation is separate from the normal test run (it costs money).
export default defineConfig({ test: { include: ["evals/**/*.eval.ts"], testTimeout: 40 * 60_000 } });
