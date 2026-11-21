// Package boundaries from ADR 0003 ("May import" column).
// Each rule's comment is printed by `pnpm check` and must say where the code should go instead.
const INTERNAL = "^(packages|apps|tools)/";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "lang-core-imports-nothing-internal",
      severity: "error",
      comment:
        "packages/lang-core may not import any other workspace package (ADR 0003). Move the shared type or interface into packages/lang-core, or move the code that needs the other package into that package.",
      from: { path: "^packages/lang-core/" },
      to: { path: INTERNAL, pathNot: "^packages/lang-core/" },
    },
    {
      name: "pack-imports-only-lang-core",
      severity: "error",
      comment:
        "A language pack (packages/lang-NNNN) may import only packages/lang-core (ADR 0003, ADR 0006). Put shared types in packages/lang-core and version-independent logic in packages/engine.",
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
        "packages/engine may import only packages/lang-core and a language pack's entry module (packages/lang-NNNN/src/index.ts), which exposes the LanguagePack interface (ADR 0003). Don't reach into a pack's internals; fetching belongs in packages/sources and UI code in apps/web.",
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
        "packages/sources may import only packages/lang-core (ADR 0003). Parsing and model code belongs in packages/engine; UI code in apps/web.",
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
        ],
      },
    },
    {
      name: "tools-standalone",
      severity: "error",
      comment:
        "tools/* are standalone build-time tools (ADR 0003) and may not import workspace packages, apps or other tools. Copy what the tool needs into tools/<tool>/, or have it write a generated file that the package reads.",
      from: { path: "^tools/([^/]+)/" },
      to: { path: INTERNAL, pathNot: "^tools/$1/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "^(apps|packages|tools)/",
    exclude: { path: "(^|/)node_modules/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
  },
};
