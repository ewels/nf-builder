// F-107: two legacy processes with a lone unnamed output, for pipes and forks. Shapes from
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/workflow.mdx#L666-L723 (pipes and forks) and
// docs/process.mdx#L1105-L1116 (a single output), #L277-L304 (stub).
process GREET {
    input:
    val x

    output:
    stdout

    script:
    """
    echo '${x} world'
    """

    stub:
    """
    echo '${x} world'
    """
}

process TO_UPPER {
    input:
    val x

    output:
    stdout

    script:
    """
    echo '${x}' | tr '[:lower:]' '[:upper:]'
    """

    stub:
    """
    echo '${x}' | tr '[:lower:]' '[:upper:]'
    """
}
