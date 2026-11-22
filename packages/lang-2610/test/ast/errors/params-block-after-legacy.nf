params.outdir = 'results'

params {
    input: String
}

workflow {
    println params.input
}
