import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["src/tutor/**/*.test.ts", "src/tutor/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
