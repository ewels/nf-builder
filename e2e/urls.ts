/** The base path the e2e build and preview use, as GitHub Pages serves a project site (ADR 0040). */
export const E2E_BASE_PATH = "/nf-builder/";
export const PREVIEW_ORIGIN = "http://localhost:4173";
export const PREVIEW_URL = `${PREVIEW_ORIGIN}${E2E_BASE_PATH}`;
export const DEV_URL = "http://localhost:5173";
/** Placeholder: a custom domain may replace it (ADR 0040). */
export const PRODUCTION_URL = "https://ewels.github.io/nf-builder/";
