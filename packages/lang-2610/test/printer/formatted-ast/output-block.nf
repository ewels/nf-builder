nextflow.enable.types = true

record Sample {
    id: String
    fastq: Path
}

workflow {

    main:
    samples = channel.of(record(id: 'a', fastq: file('a.fastq')))
    summary_report = file('report.html')

    publish:
    samples = samples
    summary_report = summary_report
}

output {
    samples: Channel<Sample> {
        path 'fastq'
        index {
            path 'index.csv'
        }
    }
    summary_report: Path {
        path '.'
    }
}
