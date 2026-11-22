process SPLIT {
    input:
    val x

    output:
    val x, emit: item

    script:
    """
    echo ${x}
    """
}

workflow {
    channel.of(1, 2, 3) | map { v -> v * 2 } | view
    SPLIT(channel.of('a', 'b'))
    SPLIT.out.item.view()
    channel.of('x').tap { copy }.set { original }
    copy.view()
    original.view()
}
