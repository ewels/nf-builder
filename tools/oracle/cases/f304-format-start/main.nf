nextflow.enable.types = true

include { COUNT } from './modules/local/count/main.nf'

workflow {
    counted = COUNT(file('main.nf'), 'one')
    counted.view()
}
