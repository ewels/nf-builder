nextflow.enable.types = true

include { JOIN } from './modules/local/join/main.nf'
include { PAIR } from './subworkflows/local/pair/main.nf'

workflow {
    joined = JOIN('world', 'hello', record(tag: 'T'))
    joined.view()
    PAIR()
}
