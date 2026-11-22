nextflow.enable.types = true

record Question {
    text: String
}

record Answer {
    text: String
}

agent eval_agent {
    model 'openai/gpt-5-mini'
    instruction 'x'
    tools()

    input:
    q: Question

    output:
    r: Answer

    prompt:
    """
    ${q.text}
    """
}

workflow {
    channel.of('hi') | eval_agent | view
}
