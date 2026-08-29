import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/network.integration.test.ts"],
    testTimeout: 20_000,
  },
});
