import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// "obsidian" ships types only, so tests get a small runtime stand-in.
export default defineConfig({
  resolve: {
    alias: { obsidian: fileURLToPath(new URL("./tests/helpers/obsidian-stub.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**"],
    passWithNoTests: true,
  },
});
