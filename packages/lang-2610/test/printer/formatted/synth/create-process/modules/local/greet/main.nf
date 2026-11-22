nextflow.enable.types = true

process GREET {
    input:
    name: String

    output:
    greeting: String = "Hello, ${name}!"

    script:
    "echo ${name}"
}
