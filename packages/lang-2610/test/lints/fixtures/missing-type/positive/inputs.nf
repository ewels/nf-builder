nextflow.enable.types = true

agent qa {
    input:
    q

    output:
    answer: String

    prompt:
    "go"
}

process p {
    input:
    tuple(a, b)

    output:
    stdout()

    script:
    """
    echo hi
    """
}
