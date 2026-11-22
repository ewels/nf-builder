include { hello } from './hello.nf'
include { hello as hello_again } from './hello.nf'

workflow {
    hello()
    hello_again()
}
