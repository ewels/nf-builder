nextflow.enable.types = true

include { NEW_PROCESS } from './modules/local/new_process/main.nf'
include { NEW_WORKFLOW } from './subworkflows/local/new_workflow/main.nf'

/**
 * The pipeline's parameters. Add one here for each setting a user can change.
 */
params {
}

/**
 * The pipeline's entry workflow. Add processes and channels to the canvas to build it.
 */
workflow {
    NEW_PROCESS()
    NEW_WORKFLOW()
}
