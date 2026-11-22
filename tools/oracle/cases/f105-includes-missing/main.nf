include { A } from './modules/a'
include { C } from './missing/c'
include { NOPE } from './modules/a'
include { B } from './modules/b'
include { Q } from './pipelines/q'
include { D } from '../outside/d.nf'

workflow {
    A()
}
