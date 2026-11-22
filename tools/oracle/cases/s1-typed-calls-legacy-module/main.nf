// Spike S1 (F-005, LA-14): a typed entry workflow calls an nf-core-shaped legacy process from modules/local/
// and reads its named outputs by assignment, as typed workflows must (no .out).
// Typed calls legacy: https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L119-L162
// Named legacy outputs read as fields: same file #L211-L253. No .out in typed workflows:
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/workflow-typed.mdx#L55 and docs/static-typing-prep.mdx#L64-L80
// channel.fromPath, Path.baseName, view(transform): docs/reference/stdlib-namespaces/channel.mdx#L126,
// docs/reference/stdlib-types/path.mdx#L48, docs/reference/stdlib-types/channel.mdx#L263
nextflow.enable.types = true

include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    ch_reads = channel.fromPath("${projectDir}/data/*.txt")
        .map { reads -> [[id: reads.baseName], reads] }
    legacy_out = LEGACY_COUNT(ch_reads)
    legacy_out.txt.view { v -> "txt: ${v}" }
    legacy_out.versions.view { v -> "versions: ${v}" }
}
