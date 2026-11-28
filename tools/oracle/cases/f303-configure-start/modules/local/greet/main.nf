nextflow.enable.types = true

/**
 * Writes a greeting.
 */
process GREET {
    input:
    name: String

    output:
    text: Path = file('greeting.txt')

    script:
    """
    echo 'Hello ${name}' > greeting.txt
    """

    stub:
    """
    touch greeting.txt
    """
}
