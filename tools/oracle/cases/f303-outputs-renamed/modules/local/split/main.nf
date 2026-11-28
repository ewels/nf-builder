nextflow.enable.types = true

process SPLIT {
    input:
    word: String

    output:
    head: Path = file('first.txt')
    tail: Path = file('second.txt')

    script:
    """
    echo ${word} > first.txt
    echo ${word} > second.txt
    """

    stub:
    """
    touch first.txt second.txt
    """
}
