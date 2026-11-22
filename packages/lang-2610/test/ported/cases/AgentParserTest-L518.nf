nextflow.enable.types = true

agent qa {
    input:
    q: String

    output:
    eval('date')

    prompt:
    "go"
}
