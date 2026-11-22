nextflow.enable.types = true

agent eval_agent {
    label 'reasoning'
    label 'fast'
    model 'openai/gpt-5-mini'

    input:
    question: String

    output:
    stdout()

    prompt:
    """
    Question: ${question}
    """
}
