nextflow.enable.types = true

process ALIGN {
    input:
    sample: String

    output:
    file('aligned.txt')

    script:
    """
    echo '${sample}' > aligned.txt
    """
}
