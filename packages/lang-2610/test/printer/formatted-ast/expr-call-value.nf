def adder(x) {
    return { y -> x + y }
}

workflow {
    println(adder(1).call(
        2
    ))
    println(adder(3)).call(
        4
    )
}
