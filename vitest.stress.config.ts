import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.stress.test.ts"],
    testTimeout: 300_000,
  },
})
