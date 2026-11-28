nextflow.enable.types = true

/**
 * Writes a greeting.
 */
process GREET {
    cpus 1

    input:
    name: String
    punctuation: String?

    output:
    message: Path = file('greeting.txt')

    script:
    """
    echo 'Hello ${name}' > greeting.txt
    """

    stub:
    """
    touch greeting.txt
    """
}
