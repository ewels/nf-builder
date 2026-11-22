// Spike S1 (F-005, LA-14): a typed entry workflow calls a legacy process and a legacy workflow from another file.
// Verbatim from Nextflow's test 'should allow typed workflow to call legacy process/workflow':
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L119-L162
nextflow.enable.types = true

include { foo ; bar } from './module.nf'

workflow {
    ch = channel.of(1, 2, 3)
    bar(foo(ch))
}
