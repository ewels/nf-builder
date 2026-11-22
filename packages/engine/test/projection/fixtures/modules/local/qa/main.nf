nextflow.enable.types = true

agent QA {
    model 'openai/gpt-5-mini'

    input:
    question: String

    output:
    stdout()

    prompt:
    """
    Answer briefly: ${question}
    """
}
