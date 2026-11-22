params {
    input: String
}

params.outdir = 'results'

workflow {
    println params.input
}
