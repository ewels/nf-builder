import { fileURLToPath } from "node:url";

const dir = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url)).replace(/\/$/, "");

export const REPO_ROOT = dir("../../..");
const TOOL_DIR = `${REPO_ROOT}/tools/oracle`;
/** The pack-owned file that pins the Nextflow release. Read by path, never imported. */
export const PIN_FILE = `${REPO_ROOT}/packages/lang-2610/upstream.json`;
const CACHE_DIR = `${REPO_ROOT}/.cache`;
export const NEXTFLOW_CACHE = `${CACHE_DIR}/nextflow`;
export const ORACLE_CACHE = `${CACHE_DIR}/oracle`;
export const DEFAULT_MANIFEST = `${TOOL_DIR}/cases/cases.yaml`;
/** Read by path, never imported: tools stay standalone. */
export const FIXTURES_FILE = `${REPO_ROOT}/tools/corpus/fixtures/fixtures.yaml`;
/** Read by path, never imported: the F-102 AST fixtures and their recorded lint results (all `[]`). */
export const AST_FIXTURES_FILE = `${REPO_ROOT}/packages/lang-2610/test/ast/fixtures.json`;
/** Read by path, never imported: the F-102 builder-error inputs and the lint errors recorded for each. */
export const AST_ERRORS_FILE = `${REPO_ROOT}/packages/lang-2610/test/ast/errors.json`;
/** Read by path, never imported: the F-110 printer fixture trees (inputs, `nextflow lint -format` goldens, printed outputs). */
export const PRINTER_FIXTURES_FILE = `${REPO_ROOT}/packages/lang-2610/test/printer/fixtures.json`;
/** Read by path, never imported: the F-103 config builder-error inputs and the lint errors recorded for each. */
export const CONFIG_AST_ERRORS_FILE = `${REPO_ROOT}/packages/lang-2610/test/config-ast/errors.json`;
/** Read by path, never imported: the F-106 type-probe tree; lint's error on each `def probeN: Boolean = <expr>` line reveals the type nf-lang infers. */
export const PROJECTION_FIXTURES_FILE = `${REPO_ROOT}/packages/engine/test/projection/fixtures.json`;
/** Read by path, never imported: the F-108 free-variable probe tree; lint's "is not defined" errors in each probe statement are its free reads. */
export const FREE_VARIABLE_PROBES_FILE = `${REPO_ROOT}/packages/engine/test/projection/code/free-variables.json`;
/** Read by path, never imported: the F-112 lint fixtures and the errors and warnings recorded for each. */
export const LINT_FIXTURES_FILE = `${REPO_ROOT}/packages/lang-2610/test/lints/fixtures.json`;
