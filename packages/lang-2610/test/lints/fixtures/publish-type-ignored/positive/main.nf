nextflow.enable.types = true

workflow {
    main:
    summary = file('report.html')

    publish:
    summary: Path = summary
}

output {
    summary: Path {
        path '.'
    }
}
