nextflow.enable.types = true

workflow W {
    take:
    t: Channel<Integer>

    main:
    x = t.map { v -> v }

    emit:
    x = t
    y = x
}

workflow {
    W(channel.of(1))
}
