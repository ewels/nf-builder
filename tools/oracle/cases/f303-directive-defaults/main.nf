nextflow.enable.types = true

include { SIZED } from './modules/local/sized/main.nf'

workflow {
    sized = SIZED('world')
    sized.view()
}
