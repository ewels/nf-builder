nextflow.enable.types = true

include { Sample } from './types.nf'
include { params as RnaseqParams ; workflow as RNASEQ } from './rnaseq.nf'

workflow {
    println 'hello'
}
