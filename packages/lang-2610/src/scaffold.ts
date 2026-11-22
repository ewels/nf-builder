// New-file templates for Nextflow 26.10 (LA-02, LA-12). The typed process shape follows
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process-typed.mdx; the oracle case f111-start-typed lints and
// stub-runs a project that includes such modules, and the template is a printer fixed point (ADR 0032).
import type { Scaffold } from "@nf-builder/lang-core";

export const scaffold: Scaffold = {
  process: (name) =>
    `nextflow.enable.types = true

process ${name} {
    script:
    """
    echo '${name}'
    """
}
`,
};
