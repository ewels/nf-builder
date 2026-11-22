nextflow.enable.types = true

agent eval_agent {
    model 'openai/gpt-5-mini'
    instruction 'You are helpful.'
    tools()

    input:
    question: String

    output:
    stdout()

    prompt:
    """
    ${question}
    """
}
