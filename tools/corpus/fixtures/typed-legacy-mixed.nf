// Malformed on purpose: types are enabled, so the legacy process GOODBYE is not allowed in this script.
nextflow.enable.types = true

process HELLO {
    input:
    message: String

    output:
    file('hello.txt')

    script:
    """
    echo '${message}' > hello.txt
    """
}

process GOODBYE {
    input:
    val message

    output:
    path 'goodbye.txt'

    script:
    """
    echo '${message}' > goodbye.txt
    """
}
