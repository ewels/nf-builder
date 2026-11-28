nextflow.enable.types = true

process TWICE {
    input:
    text: String

    output:
    doubled: String = stdout()

    script:
    """
    echo "TWICE ${task.ext}"
    """

    stub:
    """
    echo "TWICE ${task.ext}"
    """
}
