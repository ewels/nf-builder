nextflow.enable.types = true

agent reporter {
    // a directive
    model 'openai/gpt-4o'

    input:
    // about sample
    sample: String

    output:
    report: String // the report

    prompt:
    """
    Write a report for ${sample}.
    """
}
