// F-205 (UX-21, UX-22, UX-23, UX-24): a typed entry workflow with one node of every kind the canvas draws: params,
// a channel factory, a typed local process, a legacy local process, a registry-shaped legacy module, a typed and a
// legacy named workflow (take and emit), a chain ending in a value, a code statement and an output. The edges are
// channel, value and plain. The F-205 tests project this tree; nextflow lint and a -stub run check it (ADR 0011).
// Typed code builds a legacy tuple input with tuple(): AGENTS.md, spike S1.
nextflow.enable.types = true

include { GREET } from './modules/local/greet'
include { LEGACY_COUNT } from './modules/local/legacy_count'
include { WORDCOUNT } from 'nf-core/wordcount'
include { SHOUT } from './workflows.nf'
include { LEGACY_TAIL } from './legacy.nf'

params {
    greeting: String = 'hello'
    words: Path
}

workflow {
    main:
    log.info "greeting: ${params.greeting}"
    ch_names = channel.of('ada', 'grace', 'alan')
    greeted = GREET(ch_names, params.greeting)
    ch_pairs = ch_names.map { n -> tuple([id: n], params.words) }
    counted = LEGACY_COUNT(ch_pairs)
    wc = WORDCOUNT(ch_pairs)
    shouted = SHOUT(greeted, params.words)
    tail = LEGACY_TAIL(shouted)
    total = greeted.map { g -> g.length() }.collect()

    publish:
    greetings = greeted
    counts = counted.txt
    total = total
}

output {
    greetings: Channel<String> {
        path 'greetings'
    }
    counts: Channel<Path> {
        path 'counts'
    }
    total: Value<Bag<Integer>> {
        path 'total'
    }
}
