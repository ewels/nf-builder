nextflow.enable.types = true

process PAIR {
    input:
    left: String?
    right: String

    output:
    a: Path = file('a.txt')
    b: Path = file('b.txt')

    script:
    """
    echo '${left}' > a.txt
    echo '${right}' > b.txt
    """
}
