nextflow.enable.types = true

process GREET {
    input:
    greeting: String
    name: String

    output:
    record(message: message)

    exec:
    message = "${greeting}, ${name}!"
}

process QUIET {
    """
    echo hi
    """
}
