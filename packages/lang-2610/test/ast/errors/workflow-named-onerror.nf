workflow hello {
    main:
    println 'hello'

    onError:
    println 'failed'
}
