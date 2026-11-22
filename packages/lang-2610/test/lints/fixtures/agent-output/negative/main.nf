nextflow.enable.types = true

record Answer {
    text: String
    score: Float
}

agent typed {
    input:
    q: String

    output:
    answer: Answer

    prompt:
    "go"
}

agent listed {
    input:
    q: String

    output:
    items: List<String>

    prompt:
    "go"
}
