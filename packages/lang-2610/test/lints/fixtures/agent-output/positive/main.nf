nextflow.enable.types = true

record BadAnswer {
    text: String
    meta: Map
}

agent untyped {
    input:
    q: String

    output:
    q

    prompt:
    "go"
}

agent unsupported {
    input:
    q: String

    output:
    items: List

    prompt:
    "go"
}

agent unsupported_field {
    input:
    q: String

    output:
    b: BadAnswer

    prompt:
    "go"
}

agent process_only {
    input:
    q: String

    output:
    eval('date')

    prompt:
    "go"
}
