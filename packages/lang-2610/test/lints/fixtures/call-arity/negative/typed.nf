nextflow.enable.types = true

process hello {
    input:
    x: String
    y: String

    output:
    stdout()

    script:
    """
    echo ${x} ${y}
    """
}

workflow {
    hello('a', 'b')
}
