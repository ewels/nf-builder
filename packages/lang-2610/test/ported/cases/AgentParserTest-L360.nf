nextflow.enable.types = true

agent qa {
    input:
    record(id: String, reads: Path)
    tuple(a: Integer, b: Path)

    output:
    record(id: id, a: a, summary: stdout())

    prompt:
    "Summarize ${id} ${reads} ${a} ${b}"
}
