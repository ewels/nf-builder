workflow greet {
    take:
    greetings

    main:
    messages = greetings.map { v -> "$v world!" }

    emit:
    messages
}
