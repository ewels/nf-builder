nextflow.enable.types = true

process hello {
    topic:
    stdout() >> 'versions'

    script:
    ""
}
