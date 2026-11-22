nextflow.enable.types = true

process hello {
    input:
    tuple(id: String, fastq: Path)

    script:
    ""
}
