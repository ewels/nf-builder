nextflow.enable.types = true

include {
    params as RnaseqParams ;
    workflow as RNASEQ
} from './pipelines/rnaseq.nf'
