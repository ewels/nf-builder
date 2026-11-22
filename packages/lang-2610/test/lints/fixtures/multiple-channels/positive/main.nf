nextflow.enable.types = true

process pair {
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
    pair(channel.of('a'), channel.of('b'))
}
