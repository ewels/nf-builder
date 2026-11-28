nextflow.enable.types = true

workflow SORT {
    take:
    reads: Channel<String>

    main:
    sorted = reads.map { r -> r.toUpperCase() }
    report = reads.map { r -> "sorted ${r}" }

    emit:
    sorted: Channel<String> = sorted
    report: Channel<String> = report
    extra: Channel<String> = null
}
