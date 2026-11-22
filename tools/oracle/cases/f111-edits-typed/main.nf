nextflow.enable.types = true

include { ALIGN } from './modules/local/align/main.nf'
include { COUNT_LINES } from './modules/local/count/main.nf'
include { REPORT } from './modules/local/report/main.nf'

workflow {
    reads = channel.of('a', 'b')
    more = channel.of('c')
    align = ALIGN(more)
    COUNT_LINES(align)
    REPORT()
}
