import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
    // Shell-driven tests (tests/scripts) spawn real processes — running
    // them in parallel across files makes orphan-pgrep matching ambiguous.
    fileParallelism: false,
  },
});
