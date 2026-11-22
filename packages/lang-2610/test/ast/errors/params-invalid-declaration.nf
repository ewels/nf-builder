params {
    input: String
    println 'not a parameter'
}

workflow {
    println params.input
}
