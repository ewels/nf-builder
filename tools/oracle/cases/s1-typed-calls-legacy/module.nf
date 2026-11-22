// Spike S1 (F-005): legacy process and workflow (no types flag), verbatim from
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L134-L153
// exec: runs inside Nextflow; with -stub and no stub: section the exec: body runs
// (https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/main/groovy/nextflow/processor/TaskRun.groovy#L876-L878).
process foo {
    input:
    val x

    output:
    val y

    exec:
    y = x * 2
}

workflow bar {
    take:
    ys

    emit:
    ys.map { y -> y % 3 }
}
