nextflow.enable.types = true

include { MAKE } from './modules/local/make/main.nf'
include { MAKE as MAKE_2 } from './modules/local/make/main.nf'

workflow {
    MAKE()
    MAKE_2()
}
