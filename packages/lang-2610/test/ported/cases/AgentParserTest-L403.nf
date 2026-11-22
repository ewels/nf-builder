nextflow.enable.types = true

agent qa {
    input:
    q: String

    output:
    count: Integer
    report: Path = file('report.md')

    prompt:
    "go"
}
