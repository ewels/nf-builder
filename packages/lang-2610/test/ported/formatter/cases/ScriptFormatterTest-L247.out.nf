nextflow.enable.types = true

process hello {
    debug true

    input:
    tuple(id: String, infile: Path)
    index: Path

    stage:
    stageAs infile, 'input.txt'

    output:
    result = tuple(id, file('output.txt'))

    script:
    'cat input.txt > output.txt'
}
