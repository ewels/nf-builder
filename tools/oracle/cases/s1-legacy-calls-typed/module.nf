// Spike S1 (F-005): typed process and workflow, verbatim from
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L87-L108
// exec: runs inside Nextflow; with -stub and no stub: section the exec: body runs (TaskRun.groovy#L876-L878).
nextflow.enable.types = true

process foo {
    input:
    x: Integer

    output:
    y: Integer

    exec:
    y = x * 2
}

workflow bar {
    take:
    ys: Channel<Integer>

    emit:
    ys.map { y -> y * 2 }
}
