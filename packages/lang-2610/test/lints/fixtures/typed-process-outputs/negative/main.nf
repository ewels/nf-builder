nextflow.enable.types = true

process split {
    input:
    name: String

    output:
    stdout()

    script:
    """
    echo ${name}
    """
}
