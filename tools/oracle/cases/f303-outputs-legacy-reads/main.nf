include { SPLIT } from './modules/local/split/main.nf'

workflow {
    SPLIT('hello')
    SPLIT.out.head.view()
    SPLIT.out.tail.view()
}
