nextflow.enable.types = true

include { greet ; Sample ; Kind } from './lib/samples.nf'

workflow {
    main:
    sample = record(id: 'S1', kind: Kind.PAIRED)
    println greet(sample.id)
}
