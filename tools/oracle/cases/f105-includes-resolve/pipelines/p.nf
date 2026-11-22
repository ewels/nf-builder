nextflow.enable.types = true
params {
    x: String
}
workflow {
    println params.x
}
