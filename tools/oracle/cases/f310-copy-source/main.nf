nextflow.enable.types = true

include { MAKE } from './modules/local/make/main.nf'
include { SIZE } from './modules/local/size/main.nf'

workflow {
    make = MAKE()
    SIZE(make)
}
