import { fileURLToPath } from "node:url";

const dir = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\/$/, "");

export const REPO_ROOT = dir("../../..");
export const TOOL_DIR = `${REPO_ROOT}/tools/oracle`;
/** The pack-owned file that pins the Nextflow release. Read by path, never imported. */
export const PIN_FILE = `${REPO_ROOT}/packages/lang-2610/upstream.json`;
export const CACHE_DIR = `${REPO_ROOT}/.cache`;
export const NEXTFLOW_CACHE = `${CACHE_DIR}/nextflow`;
export const ORACLE_CACHE = `${CACHE_DIR}/oracle`;
