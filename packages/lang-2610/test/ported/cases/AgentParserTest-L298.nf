nextflow.enable.types = true

record Question {
    text: String
}

record Answer {
    answer: String
}

agent eval_agent {
    model 'openai/gpt-5-mini'
    instruction 'You are helpful.'
    tools()

    input:
    q: Question

    output:
    a: Answer

    prompt:
    """
    ${q.text}
    """
}
