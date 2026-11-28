nextflow.enable.types = true

/**
 * Writes a greeting with each defaulted directive kind.
 */
process SIZED {
    cpus 1
    memory 1.GB
    time 1.h
    debug true

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
