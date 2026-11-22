nextflow.enable.types = true

params {
    input: Channel<String>
}

workflow {
    main:
    upper = params.input.map { s -> s.toUpperCase() }

    publish:
    upper = upper
}

output {
    upper: Channel<String> {
        path 'upper'
    }
}
