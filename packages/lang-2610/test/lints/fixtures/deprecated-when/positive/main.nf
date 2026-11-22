process hello {
    input:
    val x

    when:
    x > 1

    script:
    """
    echo ${x}
    """
}

workflow {
    hello(channel.of(1, 2))
}
