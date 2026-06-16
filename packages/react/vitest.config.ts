import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "happy-dom",
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
})
