import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    exclude: ["subagents/**", "node_modules/**"],
  },
});
