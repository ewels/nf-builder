workflow hello {
    main:
    println 'hello'

    onComplete:
    println 'done'
}
