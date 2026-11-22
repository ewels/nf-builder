nextflow.enable.types = true

record Question {
    text: String
}

record Answer {
    plan: String
}

agent eval_agent {
    model 'openai/gpt-5-mini'
    instruction 'You are helpful.'
    tools()
    maxIterations 20

    input:
    question: Question

    output:
    plan: Answer

    prompt:
    """
    Question: ${question.text}
    """
}
