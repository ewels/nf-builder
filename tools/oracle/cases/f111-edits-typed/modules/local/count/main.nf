nextflow.enable.types = true

process COUNT_LINES {
    input:
    aligned: Path

    output:
    file('count.txt')

    script:
    """
    wc -l < ${aligned} > count.txt
    """
}
