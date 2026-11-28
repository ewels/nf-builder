nextflow.enable.types = true

record Sample {
    id: String
    reads: Path
}

process describe {
    input:
    sample: Sample

    output:
    stdout()

    script:
    """
    echo ${sample.id}
    """
}

workflow {
    describe(channel.of(record(id: 'a', reads: file('a.txt'))))
}
