nextflow.enable.types = true

agent reporter {
    model 'openai/gpt-4o'
    instruction 'You write QA reports.'
    skills 'qa-report', 'style'

    input:
    sample: String
    depth: Integer

    output:
    stdout()

    prompt:
    """
    Write a report for ${sample} at depth ${depth}.
    """
}
