nextflow.enable.types = true

params {
    message: String = 'Hello world!'
}

workflow {
    main:
    println params.message
}
