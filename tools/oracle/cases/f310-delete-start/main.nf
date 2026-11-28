nextflow.enable.types = true

include { MAKE } from './modules/local/make/main.nf'
include { SIZE } from './modules/local/size/main.nf'
include { STAMP } from './modules/local/stamp/main.nf'

workflow {
    make = MAKE()
    SIZE(make)
    STAMP()
}
