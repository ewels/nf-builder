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
];
