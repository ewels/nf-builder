nextflow.enable.types = true

process hello {
    input:
    tuple(id: String)

    script:
    ""
}
