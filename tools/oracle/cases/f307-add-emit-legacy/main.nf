workflow ALIGN {
    take:
    reads

    main:
    reads.view()

    emit:
    extra = null
}

workflow {
    reads = channel.of('a', 'b')
    ALIGN(reads)
}
