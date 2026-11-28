nextflow.enable.types = true

enum Kind {
    SINGLE,
    PAIRED
}

record Sample {
    id: String
    kind: Kind
}

def greet(name: String) -> String {
    "Hello, ${name}!"
}
