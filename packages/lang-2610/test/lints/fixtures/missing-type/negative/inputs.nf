nextflow.enable.types = true

agent qa {
    input:
    q: String

    output:
    answer: String

    prompt:
    "go"
}

process p {
    input:
    tuple(a: String, b: String)

    output:
    stdout()

    script:
    """
    echo hi
    """
}
