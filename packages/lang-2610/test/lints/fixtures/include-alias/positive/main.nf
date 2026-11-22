nextflow.enable.types = true

include { Sample as S } from './types.nf'
include { params ; workflow } from './rnaseq.nf'

workflow {
    println 'hello'
}
