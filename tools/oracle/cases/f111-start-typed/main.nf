nextflow.enable.types = true

include { ALIGN } from './modules/local/align/main.nf'
include { COUNT } from './modules/local/count/main.nf'
include { PAIR } from './modules/local/pair/main.nf'

workflow {
    reads = channel.of('a', 'b')
    more = channel.of('c')
    COUNT(channel.fromPath("${projectDir}/data/*.txt"))
    more.view()
}
