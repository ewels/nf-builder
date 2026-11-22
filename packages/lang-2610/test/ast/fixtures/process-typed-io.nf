nextflow.enable.types = true

process FASTQC {
    input:
    sample: Record
    reads: Path

    output:
    record(id: sample.id, html: file('*.html'), zip: file('*.zip'))

    script:
    """
    fastqc ${reads}
    """
}

process QUANT {
    input:
    record(id: String, fastq: Path,)
    tuple(prefix: String, index: Path)

    output:
    quant: Path = file('quant')
    log: Path = file('*.log')
    stdout_text = stdout()

    topic:
    stdout() >> 'versions'

    script:
    """
    salmon quant ${index} ${fastq} > ${prefix}.log
    """
}
