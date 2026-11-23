// Malformed on purpose: the entry workflow has a stray closing parenthesis; process FOO, with a blank line before stub:, is valid.
process FOO {
    input:
    val x

    output:
    stdout

    script:
    """
    echo $x
    """

    stub:
    """
    echo stub
    """
}

workflow {
    FOO(channel.of(1)) )
}
