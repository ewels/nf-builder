// Package boundaries from ADR 0003 ("May import" column).
// Each rule's comment is printed by `pnpm check` and must say where the code should go instead.
const INTERNAL = "^(packages|apps|tools|scripts|e2e)/";
// Root build- and test-time code (ADR 0014).
const BUILD_CODE = "^(scripts|e2e)/";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "lang-core-imports-nothing-internal",
      severity: "error",
      comment:
        "packages/lang-core may not import any other workspace package or the root scripts/ and e2e/ (ADR 0003). Move the shared type or interface into packages/lang-core, or move the code that needs the other package into that package.",
      from: { path: "^packages/lang-core/" },
      to: { path: INTERNAL, pathNot: "^packages/lang-core/" },
    },
    {
      name: "pack-imports-only-lang-core",
      severity: "error",
      comment:
        "A language pack (packages/lang-NNNN) may import only packages/lang-core, never the root scripts/ or e2e/ (ADR 0003, ADR 0006). Put shared types in packages/lang-core and version-independent logic in packages/engine.",
      from: { path: "^packages/(lang-[0-9]+)/" },
      to: {
        path: INTERNAL,
        pathNot: ["^packages/lang-core/", "^packages/$1/"],
      },
    },
    {
      name: "engine-imports-only-lang-core-and-pack-entries",
      severity: "error",
      comment:
        "packages/engine may import only packages/lang-core and a language pack's entry module (packages/lang-NNNN/src/index.ts), which exposes the LanguagePack interface, never the root scripts/ or e2e/ (ADR 0003). Don't reach into a pack's internals; fetching belongs in packages/sources and UI code in apps/web.",
      from: { path: "^packages/engine/" },
      to: {
        path: INTERNAL,
        pathNot: [
          "^packages/lang-core/",
          "^packages/engine/",
          "^packages/lang-[0-9]+/src/index\\.ts$",
        ],
      },
    },
    {
      name: "sources-imports-only-lang-core",
      severity: "error",
      comment:
        "packages/sources may import only packages/lang-core, never the root scripts/ or e2e/ (ADR 0003). Parsing and model code belongs in packages/engine; UI code in apps/web.",
      from: { path: "^packages/sources/" },
      to: {
        path: INTERNAL,
        pathNot: ["^packages/lang-core/", "^packages/sources/"],
      },
    },
    {
      name: "web-not-to-pack",
      severity: "error",
      comment:
        "apps/web must never import a language pack (packages/lang-NNNN) directly (ADR 0003). Go through packages/engine, and import shared types from packages/lang-core.",
      from: { path: "^apps/web/" },
      to: { path: "^packages/lang-[0-9]+/" },
    },
    {
      name: "web-imports-only-listed-packages",
      severity: "error",
      comment:
        "apps/web may import only packages/lang-core, packages/engine and packages/sources (ADR 0003). Move the code you need into one of those packages.",
      from: { path: "^apps/web/" },
      to: {
        path: INTERNAL,
        pathNot: [
          "^apps/web/",
          "^packages/(lang-core|engine|sources)/",
          "^packages/lang-[0-9]+/",
          // vite.config.ts may use the root scripts/; apps/web/src may not (web-src-not-to-build-scripts).
          BUILD_CODE,
        ],
      },
    },
    {
      name: "web-worker-no-github-client",
      severity: "error",
      comment:
        "The engine worker must not reach the GitHub client (packages/sources/src/github/): the document fetches and passes the worker data (QA-30, ADR 0040; package boundaries, ADR 0003). Import only @nf-builder/sources or @nf-builder/sources/import in worker code.",
      from: { path: "^apps/web/src/engine/engine\\.worker\\.ts$" },
      to: { path: "^packages/sources/src/github/", reachable: true },
    },
    {
      name: "web-src-not-to-build-scripts",
      severity: "error",
      comment:
        "Root scripts/ and e2e/ are build- and test-time code (ADR 0014); app code (apps/web/src) must not import them. Put shared runtime code in a package such as packages/engine (ADR 0003).",
      from: { path: "^apps/web/src/" },
      to: { path: BUILD_CODE },
    },
    {
      name: "tools-standalone",
      severity: "error",
      comment:
        "tools/* are standalone build-time tools (ADR 0003) and may not import workspace packages, apps, other tools or the root scripts/ and e2e/. Copy what the tool needs into tools/<tool>/, or have it write a generated file that the package reads.",
      from: { path: "^tools/([^/]+)/", pathNot: "^tools/registry-snapshot/" },
      to: { path: INTERNAL, pathNot: "^tools/$1/" },
    },
    {
      name: "registry-snapshot-imports-only-lang-core-and-pack-entries",
      severity: "error",
      comment:
        "tools/registry-snapshot may import only packages/lang-core and a language pack's entry module (packages/lang-NNNN/src/index.ts), never pack internals, packages/engine, other tools or the root scripts/ and e2e/ (ADR 0003, amended by ADR 0035). Put shared types in packages/lang-core; copy anything else the tool needs into tools/registry-snapshot/.",
      from: { path: "^tools/registry-snapshot/" },
      to: {
        path: INTERNAL,
        pathNot: [
          "^packages/lang-core/",
          "^tools/registry-snapshot/",
          "^packages/lang-[0-9]+/src/index\\.ts$",
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "^(apps|packages|tools|scripts|e2e)/",
    exclude: { path: "(^|/)dist/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
    },
  },
};
