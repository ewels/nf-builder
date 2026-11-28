nextflow.enable.types = true

include { Sample } from './types.nf'
include { DESCRIBE } from './modules/local/describe/main.nf'
include { TOUCH } from './modules/local/touch/main.nf'

params {
    input: Channel<Sample>
}

workflow {
    touch = TOUCH()
    DESCRIBE(touch)
}
