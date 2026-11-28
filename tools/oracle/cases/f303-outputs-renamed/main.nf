nextflow.enable.types = true

include { SPLIT } from './modules/local/split/main.nf'

workflow {
    parts = SPLIT('hello')
    parts.head.view()
    parts.tail.view()
}
