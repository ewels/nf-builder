nextflow.enable.types = true

workflow hello {
    take:
    x: Integer
    y: Integer

    main:
    xy = x * y

    emit:
    result: Integer = xy
}
