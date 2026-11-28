nextflow.enable.types = true

include { MAKE } from './modules/local/make/main.nf'
include { SIZE } from './modules/local/size/main.nf'

/**
 * The pipeline's parameters. Add one here for each setting a user can change.
 */
params {
}

/**
 * The pipeline's entry workflow. Add processes and channels to the canvas to build it.
 */
workflow {
    make = MAKE()
    SIZE(make)
}
