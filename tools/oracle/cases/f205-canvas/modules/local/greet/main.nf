// F-205 (UX-23): a typed process with two inputs and one output.
nextflow.enable.types = true

process GREET {
    input:
    name: String
    greeting: String

    output:
    line: String = stdout()

    script:
    """
    echo '${greeting} ${name}'
    """

    stub:
    """
    echo '${greeting} ${name}'
    """
}
