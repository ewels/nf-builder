nextflow.enable.types = true

params {
    input: String
}

workflow {
    main:
    println params.input
}
