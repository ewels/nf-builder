nextflow.enable.types = true

include { A } from './modules/local/a'
include { B ; B as B2 } from './modules/local/b'
include { C } from './modules/local/c.nf'
include { S } from './subworkflows/local/s'
include { TOP } from 'nf-core/top'
include { SUB } from 'nf-core/sub'
include { samplesheetToList } from 'plugin/nf-schema'
include { workflow as P ; params as PParams } from './pipelines/p.nf'

workflow {
    A()
}
