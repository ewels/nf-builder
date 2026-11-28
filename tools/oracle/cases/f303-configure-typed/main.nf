nextflow.enable.types = true

include { GREET } from './modules/local/greet/main.nf'

workflow {
    greet = GREET('world', null)
    greet.view()
}
