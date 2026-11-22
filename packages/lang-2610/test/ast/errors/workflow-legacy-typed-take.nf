workflow hello {
    take:
    x: Channel<String>

    main:
    x.view()
}
