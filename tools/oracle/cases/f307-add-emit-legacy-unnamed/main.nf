workflow ALIGN {
    take:
    reads

    main:
    doubled = reads.map { v -> v * 2 }

    emit:
    reads
    doubled
    extra = null
}

workflow {
    ALIGN(channel.of(1, 2))
}
