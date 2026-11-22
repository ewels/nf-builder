workflow {
    main:
    x = channel.of(1)

    emit:
    x
}
