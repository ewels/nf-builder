// Malformed on purpose: the entry workflow is missing its closing brace, so it runs to the end of the file.
process SAY_HELLO {
    input:
    val greeting

    output:
    stdout

    script:
    """
    echo '${greeting}'
    """
}

workflow {
    SAY_HELLO(channel.of('Hello', 'Hola'))
