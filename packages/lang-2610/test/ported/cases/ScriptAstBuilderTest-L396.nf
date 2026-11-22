workflow hello {
    emit:
    if( true )
        'hello'
    else
        'world'
}
