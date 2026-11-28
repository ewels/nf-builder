nextflow.enable.types = true

process SIZE {
    input:
    data: Path

    output:
    file('size.txt')

    script:
    """
    wc -c < ${data} > size.txt
    """

    stub:
    """
    touch size.txt
    """
}
