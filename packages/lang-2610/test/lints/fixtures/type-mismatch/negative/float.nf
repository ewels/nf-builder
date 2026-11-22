nextflow.enable.types = true

process scale {
    input:
    factor: Float

    output:
    stdout()

    script:
    """
    echo ${factor}
    """
}

workflow {
    scale(channel.of(1, 2))
}
