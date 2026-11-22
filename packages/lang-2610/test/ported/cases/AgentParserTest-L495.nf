nextflow.enable.types = true

agent qa {
    input:
    q: String

    output:
    record(
        summary: stdout(),
        report: file('report.md'),
        notes: files('*.txt')
    )

    prompt:
    "go"
}
