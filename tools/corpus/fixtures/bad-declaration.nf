// Malformed on purpose: process SECOND has a syntax error in its script section; FIRST and the entry workflow are valid.
process FIRST {
    input:
    val greeting

    output:
    stdout

    script:
    """
    echo '${greeting}'
    """
}

process SECOND {
    input:
    val greeting

    output:
    stdout

    script:
    def prefix = = 'Hello'
    """
    echo '${prefix} ${greeting}'
    """
}

workflow {
    FIRST(channel.of('Hello', 'Hola'))
    SECOND(channel.of('Bonjour'))
}
