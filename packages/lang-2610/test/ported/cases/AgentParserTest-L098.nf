nextflow.enable.types = true

agent eval_agent {
    model 'openai/gpt-5-mini'
    tools()

    input:
    question: String

    output:
    stdout()

    prompt:
    """
    Question: ${question}
    """
}
