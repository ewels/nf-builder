nextflow.enable.types = true

process STAMP {
    output:
    file('stamp.txt')

    script:
    """
    date > stamp.txt
    """

    stub:
    """
    touch stamp.txt
    """
}
