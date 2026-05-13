import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Per-file env opt-in via `// @vitest-environment jsdom` comment at the
    // top of each component test. Keeps existing 164 tests on the faster
    // node env (environmentMatchGlobs was removed in Vitest 4).
    setupFiles: ["tests/setup-dom.ts"],
  },
});
