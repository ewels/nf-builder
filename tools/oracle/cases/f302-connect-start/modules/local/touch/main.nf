nextflow.enable.types = true

process TOUCH {
    output:
    file('touched.txt')

    script:
    """
    touch touched.txt
    """

    stub:
    """
    touch touched.txt
    """
}
