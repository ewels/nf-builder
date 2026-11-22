process HELLO {
    input:
    val x

    output:
    stdout

    script:
    """
    echo ${x} again
    """
}
