nextflow.enable.types = true

process hello {
    input:
    tuple(id: String, infile: Path) // the sample
    index: Path                     // the index
    opts: Map<String, String>?      // extra options

    output:
    result: Path = file('output.txt') // the result
    log = stdout()                    // the log

    script:
    'cat input.txt > output.txt'
}
