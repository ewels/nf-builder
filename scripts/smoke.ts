// pnpm smoke (F-004, ADR 0016): run at the start of every session. A fresh production build (Playwright's
// preview web server runs `pnpm build` first) plus the @smoke end-to-end tests on Chromium, in under 60 s.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { SMOKE_TAG } from "../e2e/browsers.ts";
import { isMain, REPO_ROOT } from "./check-common.ts";

export const SMOKE_BUDGET_MS = 60_000;
const BUDGET = `${SMOKE_BUDGET_MS / 1000} s`;

export function smokeArgs(argv: readonly string[]): string[] {
  const rest = argv[0] === "--" ? argv.slice(1) : argv;
  return ["--grep", SMOKE_TAG, ...rest];
}

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

export function smokeVerdict(
  elapsedMs: number,
  status: number | null,
): { exitCode: number; message: string } {
  if (status !== 0) {
    return {
      exitCode: status ?? 1,
      message: `smoke: failed after ${seconds(elapsedMs)} s (Playwright exit code ${status ?? "none"}). The build or the app shell is broken; fixing it is the next work (AGENTS.md, Every session).`,
    };
  }
  if (elapsedMs >= SMOKE_BUDGET_MS) {
    return {
      exitCode: 1,
      message: `smoke: the test passed but the run took ${seconds(elapsedMs)} s; F-004 requires under ${BUDGET}. Check the timings above: the build (pnpm build), the web servers, or the test.`,
    };
  }
  return {
    exitCode: 0,
    message: `smoke: passed in ${seconds(elapsedMs)} s (F-004 budget: under ${BUDGET})`,
  };
}

if (isMain(import.meta)) {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, "scripts/run-playwright.ts"),
      ...smokeArgs(process.argv.slice(2)),
    ],
    { stdio: "inherit", env: { ...process.env, PW_BROWSERS: "chromium" } },
  );
  if (result.error) console.error(result.error);
  const verdict = smokeVerdict(performance.now() - started, result.status);
  (verdict.exitCode === 0 ? console.log : console.error)(verdict.message);
  process.exitCode = verdict.exitCode;
}
