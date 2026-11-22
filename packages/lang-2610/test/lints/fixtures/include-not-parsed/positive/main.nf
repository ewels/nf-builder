include { hello } from './broken.nf'

workflow {
    hello()
}
