nextflow.enable.types = true

workflow WORKFLOW {
    take:
    samples: Channel<Tuple<String,Path>> // the samples
    reference: Path // the reference
    skip: Boolean

    main:
    result = samples

    emit:
    result: Channel<Tuple<String,Path>> = result // the result
    count: Integer = 1 // the count
}
