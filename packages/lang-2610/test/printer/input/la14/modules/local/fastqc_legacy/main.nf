process FASTQC_LEGACY {
    input:
    tuple val(meta), path(reads)

    output:
    tuple val(meta), path('*.html'), emit: html

    script:
    """
    fastqc ${reads}
    """
}
