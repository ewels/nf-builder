nextflow.enable.types = true

params {
    // Input file.
    input: Path

    max: Integer = 100 // upper bound
    flag: Boolean = false

    name: String?
}

workflow {
    println(params.input)
}
