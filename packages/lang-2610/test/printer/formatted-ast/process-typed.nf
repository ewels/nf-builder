nextflow.enable.types = true

process greet {
    input:
    greeting: String
    name: String

    stage:
    env 'NAME', name

    output:
    stdout()

    topic:
    eval('bash --version') >> 'versions'

    script:
    """
    echo "${greeting}, \${NAME}!"
    """
}
