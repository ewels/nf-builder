// The diagnostic codes this pack describes (F-112, ADR 0005). Later tasks add the rule-backed codes.
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
];
