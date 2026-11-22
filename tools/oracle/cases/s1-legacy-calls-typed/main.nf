// Spike S1 (F-005, LA-14): a legacy entry workflow calls a typed process and a typed workflow from another file.
// Verbatim from Nextflow's test 'should allow legacy workflow to call typed process/workflow':
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L74-L117
include { foo ; bar } from './module.nf'

workflow {
    ch = channel.of(1, 2, 3)
    bar(foo(ch))
}
