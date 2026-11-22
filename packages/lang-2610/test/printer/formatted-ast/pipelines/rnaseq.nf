nextflow.enable.types = true

params {
    input: String
}

workflow {
    println(params.input)
}
