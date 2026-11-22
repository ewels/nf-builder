import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT: string = fileURLToPath(
  new URL("../..", import.meta.url),
);
// Spike S5 (ADR 0024) uses 4175; ADR 0022.
export const SPIKE_PORT = 4177;
export const SPIKE_QA30_PORT = 4178;
export const SPIKE_URL = `http://localhost:${SPIKE_PORT}`;
export const SPIKE_QA30_URL = `http://localhost:${SPIKE_QA30_PORT}`;
export const CACHE_DIR: string = join(REPO_ROOT, ".cache/s3-spike");
export const PUBLIC_DIR: string = join(CACHE_DIR, "public");
export const DIST_DIR: string = join(CACHE_DIR, "dist");
export const RESULTS_DIR: string = join(CACHE_DIR, "results");
export const LANGUAGE_SERVER_CACHE: string = join(
  REPO_ROOT,
  ".cache/language-server",
);
export const WWW_DIR: string = join(REPO_ROOT, "e2e/s3-spike/www");
export const FIXTURE_PATH: string = join(
  REPO_ROOT,
  "tools/oracle/cases/s3-known-error-500/main.nf",
);
export const EXPECTED_PATH: string = join(
  REPO_ROOT,
  "e2e/s3-spike/expected-diagnostics.json",
);
