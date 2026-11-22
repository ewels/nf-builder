process HELLO {
    input:
    val x

    output:
    stdout

    script:
    """
    echo ${x}
    """
}

process BYE {
    output:
    stdout

    script:
    """
    echo bye
    """
}

workflow {
    HELLO(channel.of(1))
    HELLO(channel.of(2))
    channel.of(3) | HELLO
    BYE()
    BYE.out.view()
    BYE()
}
