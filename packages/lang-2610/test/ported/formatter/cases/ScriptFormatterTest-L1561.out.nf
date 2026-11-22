nextflow.enable.types = true

process hello {
    input:
    record(
        id: String,
        infile: Path
    ) // the sample
    index: Path // the index

    script:
    'cat input.txt > output.txt'
}
