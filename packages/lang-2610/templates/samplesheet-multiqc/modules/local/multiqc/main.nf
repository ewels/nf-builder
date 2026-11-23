nextflow.enable.types = true

/**
 * Summarises the FastQC reports of all samples in one MultiQC report.
 *
 * @param reports The FastQC reports of every sample.
 * @return The MultiQC report.
 */
process MULTIQC {
    conda 'bioconda::multiqc=1.35'

    input:
    reports: Bag<Path>

    output:
    file('multiqc_report.html')

    topic:
    tuple('multiqc', eval('multiqc --version | sed "s/.* //g"')) >> 'versions'

    script:
    """
    multiqc --force --filename multiqc_report.html .
    """

    stub:
    """
    touch multiqc_report.html
    """
}
