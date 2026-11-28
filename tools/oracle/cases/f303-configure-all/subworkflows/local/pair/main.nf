nextflow.enable.types = true

include { JOIN } from '../../../modules/local/join/main.nf'

workflow PAIR {
    pair = JOIN('b', 'a', record(tag: 'P'))
    pair.view()
}
