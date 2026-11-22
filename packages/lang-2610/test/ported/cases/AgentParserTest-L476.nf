nextflow.enable.types = true

record Answer {
    text: String
}

record BadAnswer {
    text: String
    meta: Map
}

agent qa {
    input:
    q: String

    output:
    a: Answer

    prompt:
    "go"
}
