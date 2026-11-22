// Spike S1 (F-005, LA-14): a legacy entry workflow (no types flag) builds records and calls a typed
// process with a record input from modules/local/, as a pipeline using typed nf-core modules would.
// Legacy calls typed: https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L74-L117
// record(): https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/reference/stdlib-namespaces/global.mdx#L184
// channel.fromPath: docs/reference/stdlib-namespaces/channel.mdx#L126; legacy view: docs/process.mdx#L1065-L1085
include { TYPED_COUNT } from './modules/local/typed_count/main.nf'

workflow {
    ch_samples = channel.fromPath("${projectDir}/data/*.txt")
        .map { reads -> record(id: reads.baseName, reads: reads) }
    TYPED_COUNT(ch_samples).view { v -> "count: ${v}" }
}
