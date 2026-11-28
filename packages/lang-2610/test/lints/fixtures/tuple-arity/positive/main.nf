nextflow.enable.types = true

include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    LEGACY_COUNT(tuple([id: 'a']))
}
