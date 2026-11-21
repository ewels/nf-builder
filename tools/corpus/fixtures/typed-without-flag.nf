// Malformed on purpose: process HELLO declares a typed input but the script does not set nextflow.enable.types = true.
process HELLO {
    input:
    message: String

    output:
    path 'hello.txt'

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
