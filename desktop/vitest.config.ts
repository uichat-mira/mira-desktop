import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // Node 26 exposes native Web Storage globals even without a storage file.
    // Let Vitest/jsdom supply browser storage in isolated test workers.
    pool: "forks",
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
    },
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json", "json-summary"],
      reportOnFailure: true,
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/**/__mocks__/**",
        "src/**/node_modules/**",
      ],
    },
  },
});
