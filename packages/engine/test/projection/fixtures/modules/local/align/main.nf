nextflow.enable.types = true

process ALIGN {
    input:
    record(
        id: String,
        reads: Path
    )
    index: Path

    output:
    bam: Path = file("${id}.bam")
    log: String = stdout()

    topic:
    tuple('align', eval('echo 1.0')) >> 'versions'

    script:
    """
    touch ${id}.bam
    """
}

process INDEX {
    input:
    fasta: Path

    output:
    file('index')

    script:
    """
    mkdir index
    """
}
