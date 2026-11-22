process hello {
    input:
    val x

    script:
    """
    echo ${x}
    """
}

workflow {
    hello(channel.of(1, 2).filter { v -> v > 1 })
}
