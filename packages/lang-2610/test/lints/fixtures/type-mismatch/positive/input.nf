nextflow.enable.types = true

process hello {
    input:
    name: String

    output:
    stdout()

    script:
    """
    echo ${name}
    """
}

workflow {
    hello(channel.of(1, 2))
}
