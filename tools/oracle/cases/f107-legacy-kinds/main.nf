// F-107 (LA-28, ADR 0005): the runtime class of legacy dataflow values, printed as `probe <expr> <class>` lines. The
// projection's queue/value inference for legacy code must agree: DataflowVariable is a value, DataflowBroadcast and
// DataflowQueue are channels, and a call result (ChannelOut) is skipped. Probe lines follow
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/reference/operator.mdx (the Returns lines of first, last,
// collect and concat) and docs/process.mdx#L671-L700 (each repeats an input, so the result is a channel).
process ECHO {
    input:
    val x
    each mode

    output:
    val x, emit: same
    stdout emit: text

    script:
    """
    echo ${x} ${mode}
    """

    stub:
    """
    echo stub
    """
}

process ONE {
    input:
    val x

    output:
    val x

    exec:
    true
}

process TWO {
    input:
    val x

    output:
    val x

    exec:
    true
}

workflow {
    a = channel.of(1, 2)
    b = a.first()
    c = a.collect()
    ECHO(b, ['m1', 'm2'])
    ONE(b)
    TWO(a)
    println("probe a ${a.getClass().getSimpleName()}")
    println("probe b ${b.getClass().getSimpleName()}")
    println("probe c ${c.getClass().getSimpleName()}")
    println("probe ECHO.out.same ${ECHO.out.same.getClass().getSimpleName()}")
    println("probe ONE.out[0] ${ONE.out[0].getClass().getSimpleName()}")
    println("probe TWO.out[0] ${TWO.out[0].getClass().getSimpleName()}")
    println("probe concat ${a.concat(b).getClass().getSimpleName()}")
    println("probe last ${a.last().getClass().getSimpleName()}")
    println("probe value.map ${b.map { v -> v }.getClass().getSimpleName()}")
}
