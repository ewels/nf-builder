agent qa {
    model = 'openai/gpt-5-mini'

    input:
    question: String

    output:
    stdout()

    prompt:
    """
    Answer briefly: ${question}
    """
}
