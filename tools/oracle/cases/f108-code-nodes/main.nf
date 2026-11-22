// F-108 (AR-13, LA-27, ADR-0004): arbitrary Groovy statements between dataflow, each of which becomes a code node whose
// inputs are the graph values it reads and whose outputs are the variables it assigns. Every construct here is checked
// with the pinned lint and a -stub run; the F-108 tests project this file and expect these code nodes and wires.
include { TYPED_TAIL } from './typed.nf'

process ANNOTATE {
    input:
    tuple val(meta), val(mode)

    output:
    tuple val(meta), path("${meta.id}.${mode}.txt"), emit: txt

    script:
    """
    echo ${mode} > ${meta.id}.${mode}.txt
    """

    stub:
    """
    touch ${meta.id}.${mode}.txt
    """
}

def helper(ch) {
    return ch.map { v -> v.toUpperCase() }
}

workflow SUMMARISE {
    take:
    pairs

    main:
    def (fwd, rev) = ['R1', 'R2']
    tagged = pairs.map { pair -> "${fwd}:${pair}" }

    emit:
    tagged = tagged
}

workflow {
    main:
    reads_ch = channel.of('a', 'b')

    def summary = [:]
    summary['reads'] = params.reads

    if (params.reads) {
        mode = 'paired'
        def tmp = mode.toUpperCase()
        log.info("mode ${tmp}")
    }
    else {
        mode = 'single'
    }

    try {
        threshold = params.threshold as Integer
    }
    catch (Exception err) {
        threshold = 0
    }

    count = 0
    count += 1

    label = "run ${mode} with ${threshold}"
    log.info("starting ${label}")

    lst = []
    lst << mode

    scale = { v -> v * threshold }
    assert threshold >= 0

    res = helper(reads_ch)

    unwired = reads_ch.map { v -> "${label}:${v}" }

    meta_ch = reads_ch.map { v -> tuple([id: v], mode) }
    annotated = ANNOTATE(meta_ch)
    summarised = SUMMARISE(res)
    typed = TYPED_TAIL(unwired)

    workflow.onComplete {
        log.info("done after ${count} step(s)")
    }

    annotated.txt.view { t -> "txt: ${t}" }
    summarised.tagged.view { t -> "tagged: ${t}" }
    typed.out.view { t -> "typed: ${t}" }
}
