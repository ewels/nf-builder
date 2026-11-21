// pnpm passes a literal `--` through to scripts, so `pnpm test:e2e -- --grep X` would reach
// Playwright as `test -- --grep X`, where everything after `--` is ignored and every test runs.
// Drop one leading `--` so the filter works.
// Run this repo's own Playwright CLI rather than whichever `playwright` is on PATH.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(process.execPath, [cli, "test", ...args], {
  stdio: "inherit",
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
