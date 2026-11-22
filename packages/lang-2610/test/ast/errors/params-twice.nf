params {
    input: String
}

params {
    outdir: String
}

workflow {
    println params.input
}
