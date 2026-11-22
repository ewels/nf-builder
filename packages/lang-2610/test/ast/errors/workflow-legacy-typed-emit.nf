workflow hello {
    main:
    x = channel.of('a')

    emit:
    x: Channel<String>
}
