nextflow.enable.types = true

workflow {
    main:
    summary = file('report.html')

    publish:
    summary = summary
}

output {
    summary: Integer {
        path '.'
    }
}
