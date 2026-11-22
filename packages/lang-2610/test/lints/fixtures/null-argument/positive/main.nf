nextflow.enable.types = true

process hello {
    input:
    name: String
    other: String?

    output:
    stdout()

    script:
    """
    echo ${name} ${other}
    """
}

workflow {
    hello(null, null)
}
