nextflow.enable.types = true

include { PREPARE ; Sample } from './subworkflows/local/prepare'
include { LEGACY_COUNT } from './modules/local/legacy_count'
include { QA } from './modules/local/qa'
include { workflow as SUB } from './pipelines/sub.nf'

params {
    samples: Channel<Sample>
    fasta: Path
    names: List<String> = ['a', 'b']
}

workflow {
    main:
    log.info "fasta: ${params.fasta}"
    prepared = PREPARE(params.samples, params.fasta)
    def probe1: Boolean = prepared.bams
    def probe2: Boolean = prepared.logs
    def probe3: Boolean = prepared.index
    counts = LEGACY_COUNT(prepared.bams)
    ch_names = channel.fromList(params.names)
    def probe4: Boolean = ch_names
    ch_names = ch_names.mix(channel.of('c'))
    def probe5: Boolean = ch_names
    ch_names.view { n -> "name: ${n}" }
    sub = SUB(record(input: ch_names))
    def probe6: Boolean = sub
    def probe7: Boolean = params.samples
    def probe8: Boolean = params.fasta
    report = file('report.html')
    def probe9: Boolean = report
    joined = prepared.bams
        .filter { b -> b.size() > 0 }
        .combine(index: prepared.index)

    def probe10: Boolean = joined
    def probe11: Boolean = prepared
    answers = QA(ch_names)
    def probe12: Boolean = answers
    single = QA('how?')
    def probe13: Boolean = single

    publish:
    bams = prepared.bams
    report = report
    upper = sub
}

output {
    bams: Channel<Path> {
        path 'bams'
    }
    report: Path {
        path '.'
    }
    upper: Channel<String> {
        path 'upper'
    }
}
