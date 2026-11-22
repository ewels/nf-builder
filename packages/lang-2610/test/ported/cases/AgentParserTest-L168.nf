nextflow.enable.types = true

record Question {
    text: String
}

agent broken {
    model 'openai/gpt-5-mini'
    instruction 'x'
    tools()

    input:
    q: Question
}
