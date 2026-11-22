nextflow.enable.types = true

process hello {
    input:
    name: String

    stage:
    x = name

    script:
    """
    echo ${name}
    """
}
