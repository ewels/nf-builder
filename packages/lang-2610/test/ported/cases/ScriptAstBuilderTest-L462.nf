nextflow.enable.types = true

process hello {
    output:
    target.name = 'world'

    script:
    ""
}
