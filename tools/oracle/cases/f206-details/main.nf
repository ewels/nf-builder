// F-206 (UX-30, LA-20): a typed entry workflow for the details pane: a typed params block with a default, a channel
// factory feeding a typed process with directives, a topic and a long script, a chain with a closure, an output block
// and a call to a legacy process that emits to a topic. The F-206 tests project this tree; nextflow lint and a -stub
// run check it (ADR 0011).
nextflow.enable.types = true

include { TRIM } from './modules/local/trim'
include { LEGACY_VERSIONS } from './modules/local/legacy_versions'

params {
    greeting: String = 'hello'
}

workflow {
    main:
    ch_names = channel.of('ada', 'grace', 'alan')
    trimmed = TRIM(ch_names, params.greeting)
    lengths = trimmed.map { t -> t.length() }.collect()
    LEGACY_VERSIONS(params.greeting)

    publish:
    trimmed = trimmed
    lengths = lengths
}

output {
    trimmed: Channel<String> {
        path 'trimmed'
    }
    lengths: Value<Bag<Integer>> {
        path 'lengths'
    }
}
