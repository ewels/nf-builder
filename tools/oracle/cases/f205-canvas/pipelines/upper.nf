// F-205 (UX-22): a pipeline included with `workflow as`; its params block is its input record (as in F-106's fixture).
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
