import { defineConfig } from "vitest/config";

// pnpm test:corpus: parses the whole pinned corpus (F-006). Needs .cache/corpus and .cache/corpus-lint.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.corpus.ts"],
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
    pool: "forks",
    fileParallelism: false,
  },
});
