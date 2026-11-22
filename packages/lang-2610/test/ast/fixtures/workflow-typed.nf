nextflow.enable.types = true

workflow greet {
    take:
    greetings: Channel<String>

    main:
    messages = greetings.map { v -> "$v world!" }

    emit:
    messages: Channel<String>
}
