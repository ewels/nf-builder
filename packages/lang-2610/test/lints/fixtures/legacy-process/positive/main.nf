process hello {
    input:
    val x

    output:
    stdout

    script:
    """
    echo ${x}
    """
}

workflow {
    hello(channel.of(1)).view()
}
