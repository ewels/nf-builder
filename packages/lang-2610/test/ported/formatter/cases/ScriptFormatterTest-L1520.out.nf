params {
    input: String                   // the input
    save_intermeds: Boolean = false // save intermediates
    outdir: String = 'results'
}

record FastqPair {
    id: String     // the sample id
    fastq_1: Path  // the first read
    fastq_2: Path? // the second read
}

workflow {
    println(params.input)
}
