process A {
    script:
    'echo a'
}

process B {
    script:
    'echo b'
}

workflow {
    x = true
    if (x) {
    }
    A()
    B()
}
