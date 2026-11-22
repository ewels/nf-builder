nextflow.enable.types = true

include { GREET } from './modules/local/greet/main.nf'
include { COUNT_LINES } from './modules/local/count_lines/main.nf'

// the base workflow an edit starts from
workflow {
    first = GREET('a')

    second = GREET('b')
    counted = COUNT_LINES(record(id: 'a', text: file('a.txt')))
}
