// pnpm passes a literal `--` through to scripts, so `pnpm test:e2e -- --grep X` would reach
// Playwright as `test -- --grep X`, where everything after `--` is ignored and every test runs.
// Drop one leading `--` so the filter works.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

const result = spawnSync("playwright", ["test", ...args], { stdio: "inherit" });
if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
