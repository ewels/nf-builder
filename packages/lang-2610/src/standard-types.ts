// Standard types the 26.10 docs list but the generated catalogue lacks: tools/spec-extract keeps only classes with a
// class-level @Description, and these have none (or no class). The pinned `nextflow lint` accepts these in typed
// processes (`flag: Boolean`, `sample: Record`). Kept by hand, from
// https://docs.seqera.io/nextflow/reference/stdlib-types (F-303, UX-41). The catalogue stays as generated
// (`pnpm gen:catalogue` is unaffected); the form merges these into its type suggestions.

export const standardTypes: readonly string[] = [
  "Boolean",
  "Record",
  "Tuple",
  "VersionNumber",
];
