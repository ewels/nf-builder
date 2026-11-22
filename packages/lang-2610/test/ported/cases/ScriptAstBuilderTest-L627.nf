nextflow.enable.types = true

process hello {
    input:
    record(
        id: String,
        fastq: Path,
    )

    script:
    ""
}
