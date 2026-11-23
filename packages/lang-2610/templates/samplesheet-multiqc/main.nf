nextflow.enable.types = true

include { FASTQC } from './modules/local/fastqc/main.nf'
include { MULTIQC } from './modules/local/multiqc/main.nf'

/**
 * One row of the samplesheet.
 */
record Sample {
    id: String
    fastq_1: Path
    fastq_2: Path?
}

params {
    input: Channel<Sample>
}

/**
 * Checks the quality of each sample's reads with FastQC and summarises all samples in one MultiQC report.
 */
workflow {

    main:
    fastqc = FASTQC(params.input)
    reports = fastqc.flatMap { result -> result.reports }.collect()
    multiqc_report = MULTIQC(reports)
    versions = channel.topic('versions').unique()

    publish:
    fastqc = fastqc
    multiqc_report = multiqc_report
    versions = versions
}

output {
    fastqc: Channel<Record> {
        path 'fastqc'
    }
    multiqc_report: Value<Path> {
        path 'multiqc'
    }
    versions: Channel<Tuple<String, String>> {
        index {
            path 'pipeline_info/versions.yml'
        }
    }
}
