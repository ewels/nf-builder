nextflow.enable.types = true

agent qa {
    input:
    q: String

    output:
    file('report.md')

    prompt:
    "go"
}
