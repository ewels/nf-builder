include { hello } from './missing.nf'

workflow {
    hello()
}
