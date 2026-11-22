params {
    input: Path
    max_iterations: Integer = 100
}

workflow {
    println(params.input)
}
