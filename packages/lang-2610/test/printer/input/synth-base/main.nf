nextflow.enable.types = true

include { GREET } from './modules/local/greet/main.nf'

// the base workflow an edit starts from
workflow {
    main:
    first = GREET('a')

    second = GREET('b')
}
