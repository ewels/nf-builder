nextflow.enable.types = true

agent qa {
    input:
    q: String

    output:
    summary: String = stdout()

    prompt:
    "go"
}
