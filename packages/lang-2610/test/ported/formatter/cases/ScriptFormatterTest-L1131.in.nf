params {
    // Comma-separated list of IDs.
    input: String

    // Whether to save intermediate outputs.
    save_intermeds: Boolean = false
}

workflow {
    println(params.input)
}
