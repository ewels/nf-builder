nextflow.enable.types = true

process MAKE {
    output:
    file('made.txt')

    script:
    """
    echo made > made.txt
    """

    stub:
    """
    touch made.txt
    """
}
