params.foo = 'bar'

include { foo ; bar } from './foobar.nf'

process hello {
    script:
    'echo true'
}

workflow hello {
}

workflow {
}

output {
}
