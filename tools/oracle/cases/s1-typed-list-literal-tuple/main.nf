// Spike S1 (F-005, LA-14): records a pitfall. Typed code must build legacy tuple inputs with tuple(); a mixed list literal
// such as [[id: ...], reads] fails `nextflow lint`, while `nextflow run` only warns (it type-checks as a warning).
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/main/java/nextflow/script/control/TypeCheckingVisitor.java#L1403-L1424
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/migrations/26-10.mdx#L22
// Otherwise the same as s1-typed-calls-legacy-module (typed calls legacy, docs/workflow-typed.mdx#L55).
nextflow.enable.types = true

include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    ch_reads = channel.fromPath("${projectDir}/data/*.txt")
        .map { reads -> [[id: reads.baseName], reads] }
    legacy_out = LEGACY_COUNT(ch_reads)
    legacy_out.txt.view { v -> "txt: ${v}" }
    legacy_out.versions.view { v -> "versions: ${v}" }
}
