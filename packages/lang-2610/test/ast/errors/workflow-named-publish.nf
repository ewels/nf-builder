workflow hello {
    main:
    x = channel.of(1)

    publish:
    result = x
}
