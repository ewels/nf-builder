process hello {
    input:
    val x

    script:
    """
    echo ${x}
    """
}

workflow {
    hello(channel.of(1))
}
