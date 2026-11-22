nextflow.enable.types = true

process hello {
    output:
    target <<= 'world'

    script:
    ""
}
