include {
    params as RnaseqParams ;
    workflow as RNASEQ
} from './rnaseq.nf'

workflow {
    RNASEQ(record(input: 'data.csv'))
}
