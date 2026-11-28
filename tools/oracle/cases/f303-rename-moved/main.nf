nextflow.enable.types = true

include { SAY } from './modules/local/say/main.nf'

workflow {
    greet = SAY('world')
    greet.view()
}
