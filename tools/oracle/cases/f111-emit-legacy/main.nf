workflow W {
    take:
    t

    main:
    x = t.map { v -> v }

    emit:
    x = t
    y = x
}

workflow {
    W(channel.of(1))
}
