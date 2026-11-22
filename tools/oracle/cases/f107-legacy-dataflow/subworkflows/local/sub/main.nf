// F-107 (AR-14): a legacy subworkflow with takes, an if around calls with x = x.mix(...), and emits through .out.
// Syntax: https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/workflow.mdx#L608-L629 (.out) and
// docs/workflow.mdx on take/emit.
include { GREET; TO_UPPER } from '../../../modules/local/greet/main.nf'

workflow SUB {
    take:
    ch_names
    do_upper

    main:
    ch_all = channel.empty()
    GREET(ch_names)
    ch_all = ch_all.mix(GREET.out)
    if (do_upper) {
        TO_UPPER(ch_names)
        ch_all = ch_all.mix(TO_UPPER.out)
    }

    emit:
    merged = ch_all
    greeted = GREET.out
}
