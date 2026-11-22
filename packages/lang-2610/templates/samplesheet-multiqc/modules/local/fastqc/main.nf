nextflow.enable.types = true

/**
 * Runs FastQC on the reads of one sample.
 *
 * @param id The sample name.
 * @param fastq_1 The first reads file.
 * @param fastq_2 The second reads file, when the sample is paired-end.
 * @return The sample name and its FastQC reports.
 */
process FASTQC {
    tag id
    conda 'bioconda::fastqc=0.13.0'

    input:
    record(
        id: String,
        fastq_1: Path,
        fastq_2: Path?
    )

    output:
    record(
        id: id,
        reports: files('*_fastqc.{html,zip}'),
    )

    topic:
    tuple('fastqc', eval('fastqc --version | sed "s/FastQC v//"')) >> 'versions'

    script:
    """
    fastqc --quiet ${fastq_1.name} ${fastq_2?.name ?: ''}
    """

    stub:
    """
    touch ${id}_fastqc.html ${id}_fastqc.zip
    """
}
