import { defineConfig } from "vitest/config";

/**
 * Root Vitest config. Tests live alongside source as `*.test.ts`
 * inside each package; Vitest picks them up via the `include` glob.
 *
 * We resolve `@reports/*` to package source directly so tests don't
 * depend on a build step.
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@reports/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
      "@reports/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@reports/exports": new URL("./packages/exports/src/index.ts", import.meta.url).pathname,
      "@reports/storage": new URL("./packages/storage/src/index.ts", import.meta.url).pathname,
      "@reports/connectors": new URL("./packages/connectors/src/index.ts", import.meta.url).pathname,
      "@reports/ai-gateway": new URL("./packages/ai-gateway/src/index.ts", import.meta.url).pathname,
    },
  },
});
