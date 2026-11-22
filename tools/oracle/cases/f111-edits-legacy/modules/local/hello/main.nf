nextflow.enable.types = true

process HELLO {
    script:
    """
    echo 'HELLO'
    """
}
