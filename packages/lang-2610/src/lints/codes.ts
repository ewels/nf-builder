// The diagnostic codes this pack describes (F-112, ADR 0005).
import type { DiagnosticCode } from "@nf-builder/lang-core";

const INCLUDE_UPSTREAM = [
  "modules/nf-lang/src/main/java/nextflow/script/control/ResolveIncludeVisitor.java#L90-L141",
];

const includeCode = (code: string): DiagnosticCode => ({
  code,
  severity: "error",
  spec: ["AR-03", "AR-05"],
  origin: "model",
  upstream: INCLUDE_UPSTREAM,
  lintPattern: null,
  verbatim: [],
  fixable: false,
});

const NF_LANG = "modules/nf-lang/src/main/java/nextflow";
const BUILDER = `${NF_LANG}/script/parser/ScriptAstBuilder.java`;
const RESOLVE_INCLUDE = `${NF_LANG}/script/control/ResolveIncludeVisitor.java`;
const TYPE_CHECK = `${NF_LANG}/script/control/TypeCheckingVisitor.java`;
const SCRIPT_SCOPE = `${NF_LANG}/script/control/VariableScopeVisitor.java`;

/** A code with no verbatim messages and no fix unless the caller says so. */
const code = (
  fields: Pick<DiagnosticCode, "code" | "severity" | "spec" | "origin"> &
    Partial<DiagnosticCode>,
): DiagnosticCode => ({
  upstream: [],
  lintPattern: null,
  verbatim: [],
  fixable: false,
  ...fields,
});

export const CODES: readonly DiagnosticCode[] = [
  {
    code: "syntax",
    severity: "error",
    spec: ["LA-30"],
    origin: "parser",
    upstream: [
      "modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java",
      "modules/nf-lang/src/main/java/nextflow/config/parser/ConfigAstBuilder.java",
    ],
    lintPattern: null,
    verbatim: [],
    fixable: false,
  },
  includeCode("include-target"),
  includeCode("include-not-parsed"),
  includeCode("include-name"),
  code({
    code: "deprecated-when",
    severity: "warning",
    spec: ["LA-34"],
    origin: "lint",
    upstream: [`${BUILDER}#L824`],
    lintPattern: /^The `when` section is deprecated/,
  }),
  code({
    code: "deprecated-shell",
    severity: "warning",
    spec: ["LA-34"],
    origin: "lint",
    upstream: [`${BUILDER}#L836`],
    lintPattern: /^The `shell` block is deprecated/,
    verbatim: [/^The `shell` block is deprecated, use `script` instead$/],
  }),
  code({
    code: "deprecated-channel",
    severity: "warning",
    spec: ["LA-34"],
    origin: "lint",
    upstream: [`${SCRIPT_SCOPE}#L765`],
    lintPattern:
      /^The use of `Channel` to access channel factories is deprecated/,
    fixable: true,
  }),
  code({
    code: "implicit-it",
    severity: "warning",
    spec: ["LA-34"],
    origin: "lint",
    upstream: [
      `${SCRIPT_SCOPE}#L885`,
      `${NF_LANG}/config/control/VariableScopeVisitor.java#L343`,
    ],
    lintPattern: /^Implicit closure parameter is deprecated/,
    verbatim: [
      /^Implicit closure parameter is deprecated, declare an explicit parameter instead$/,
    ],
    fixable: true,
  }),
  code({
    code: "deprecated-directive",
    severity: "warning",
    spec: ["LA-34"],
    origin: "paranoid",
    upstream: [`${NF_LANG}/script/control/VariableScopeChecker.java#L285`],
  }),
  code({
    code: "legacy-process",
    severity: "suggestion",
    spec: ["LA-35"],
    origin: "ours",
  }),
  code({
    code: "legacy-workflow",
    severity: "suggestion",
    spec: ["LA-35"],
    origin: "ours",
  }),
  code({
    code: "legacy-params",
    severity: "suggestion",
    spec: ["LA-36"],
    origin: "paranoid",
    upstream: [`${SCRIPT_SCOPE}#L271`],
  }),
  code({
    code: "params-outside-entry",
    severity: "suggestion",
    spec: ["LA-36"],
    origin: "paranoid",
    upstream: [`${SCRIPT_SCOPE}#L875`],
  }),
  code({
    code: "tuple-where-record",
    severity: "suggestion",
    spec: ["LA-36"],
    origin: "ours",
  }),
  code({
    code: "publish-dir",
    severity: "suggestion",
    spec: ["LA-36"],
    origin: "ours",
  }),
  code({
    code: "missing-type",
    severity: "warning",
    spec: ["LA-37"],
    origin: "lint",
    upstream: [
      `${BUILDER}#L597`,
      `${BUILDER}#L619`,
      `${BUILDER}#L634`,
      `${BUILDER}#L977`,
    ],
    lintPattern: /should have a type annotation$/,
  }),
  code({
    code: "typed-process-outputs",
    severity: "warning",
    spec: ["LA-37"],
    origin: "lint",
    upstream: [`${BUILDER}#L695`],
    lintPattern: /^Typed process should have only one output/,
    verbatim: [/^Typed process should have only one output -- consider /],
  }),
  code({
    code: "publish-type-ignored",
    severity: "warning",
    spec: ["LA-37"],
    origin: "lint",
    upstream: [`${BUILDER}#L1059`],
    lintPattern: /^Workflow output type should be declared in the output block/,
    verbatim: [/^Workflow output type should be declared in the output block/],
    fixable: true,
  }),
  code({
    code: "feature-flag",
    severity: "error",
    spec: ["LA-31"],
    origin: "lint",
    upstream: [`${SCRIPT_SCOPE}#L249`],
    lintPattern: /^Unrecognized feature flag/,
  }),
  code({
    code: "pipeline-include-types",
    severity: "error",
    spec: ["LA-31"],
    origin: "lint",
    upstream: [`${RESOLVE_INCLUDE}#L139-L142`],
    lintPattern:
      /^(Including a pipeline requires|An included pipeline must enable static typing)/,
  }),
  code({
    code: "config-include-placement",
    severity: "error",
    spec: ["LA-31"],
    origin: "lint",
    upstream: [`${NF_LANG}/config/control/VariableScopeVisitor.java#L204`],
    lintPattern:
      /^Config includes are only allowed at the top-level or in a profile/,
  }),
  code({
    code: "agent-output",
    severity: "error",
    spec: ["LA-31"],
    origin: "lint",
    upstream: [
      `${NF_LANG}/script/control/ScriptResolveVisitor.java#L174`,
      `${NF_LANG}/script/control/ScriptResolveVisitor.java#L179`,
      `${SCRIPT_SCOPE}#L803`,
    ],
    lintPattern: /^(Agent output `|`(eval|env)` is not defined)/,
    verbatim: [
      /^Agent output `[^`]+` (should declare a type|has unsupported )/,
    ],
  }),
  code({
    code: "include-alias",
    severity: "error",
    spec: ["AR-05"],
    origin: "lint",
    upstream: [`${SCRIPT_SCOPE}#L140`, `${SCRIPT_SCOPE}#L144`],
    lintPattern:
      /^(An included pipeline must be aliased|Included types cannot be aliased)/,
    verbatim: [/^An included pipeline must be aliased, e\.g\. /],
  }),
  code({
    code: "duplicate-name",
    severity: "error",
    spec: ["AR-05"],
    origin: "lint",
    upstream: [
      `${SCRIPT_SCOPE}#L150`,
      `${SCRIPT_SCOPE}#L183`,
      `${SCRIPT_SCOPE}#L189`,
      `${SCRIPT_SCOPE}#L210`,
      `${SCRIPT_SCOPE}#L217`,
      `${SCRIPT_SCOPE}#L260`,
    ],
    lintPattern: /is already (included|declared)$/,
    fixable: true,
  }),
  code({
    code: "call-arity",
    severity: "error",
    spec: ["LA-33"],
    origin: "lint",
    upstream: [
      `${TYPE_CHECK}#L648`,
      `${NF_LANG}/script/control/CallArityVisitor.java#L73`,
    ],
    lintPattern:
      /^(Incorrect number of call arguments|(Process|Agent|Workflow) `[^`]+` expects \d+ argument\(s\))/,
  }),
  code({
    code: "unused-output",
    severity: "warning",
    spec: ["LA-33"],
    origin: "ours",
  }),
  code({
    code: "type-mismatch",
    severity: "error",
    spec: ["LA-29", "LA-32"],
    origin: "lint",
    upstream: [
      `${TYPE_CHECK}#L1007`,
      `${TYPE_CHECK}#L829`,
      `${TYPE_CHECK}#L525`,
      `${TYPE_CHECK}#L267`,
    ],
    lintPattern:
      /^(Argument with type .+ is not compatible with (process input|agent input|parameter)|(Workflow emit `[^`]+`|Workflow output `[^`]+`|Assignment target) with type .+ cannot be assigned to value with type )/,
  }),
  code({
    code: "multiple-channels",
    severity: "error",
    spec: ["LA-32"],
    origin: "lint",
    upstream: [`${TYPE_CHECK}#L1013`],
    lintPattern: /was called with multiple channel arguments/,
    verbatim: [/ -- make sure that at most one argument is a channel/],
  }),
];
