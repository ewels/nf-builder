nextflow.enable.types = true

/**
 * Writes a friendly greeting.
 */
process GREET {
    cpus 2

    input:
    name: String

    output:
    text: Path = file('greeting.txt')

    // keep the greeting short
    script:
    """
    echo 'Hello ${name}' > greeting.txt
    """

    stub:
    """
    touch greeting.txt
    """
}
