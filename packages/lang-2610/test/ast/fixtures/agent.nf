agent qa {
    // directives
    model 'openai/gpt-5-mini'
    instruction 'You are a concise scientific assistant.'

    input:
    question: String

    output:
    stdout()

    prompt:
    """
    Answer briefly: ${question}
    """
}
