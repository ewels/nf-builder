// F-107 (AR-14, LA-21, LA-28): the legacy dataflow forms the projection models: legacy params, pipes and forks, set and
// tap, .out by name and index, a process name in a variable, a ternary over .out, legacy-only operators, and a legacy
// subworkflow. Every construct lints clean and the script runs with -stub.
// Pipes and forks: https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/workflow.mdx#L666-L723
// .out: docs/workflow.mdx#L608-L629. Operators: docs/reference/operator.mdx (first, last, concat, collate, distinct, tap, set).
params.flag = true
params.greeting = 'Hello'

include { GREET; TO_UPPER } from './modules/local/greet/main.nf'
include { ALL_INPUTS; ONE_UNNAMED; MANY_UNNAMED } from './modules/local/qualifiers/main.nf'
include { PAIR; PAIR_B; JOIN2 } from './modules/local/spread/main.nf'
include { SUB } from './subworkflows/local/sub/main.nf'

workflow {
    // a pipe into a fork, then mix and view
    channel.of(params.greeting, 'Bonjour') | map { v -> v.trim() } | (GREET & TO_UPPER) | mix | view

    // set and tap
    channel.of('x', 'y').map { v -> v + '!' }.tap { ch_copy }.set { ch_original }
    ch_copy.view()
    ch_original.view()

    // every input qualifier; outputs by name and by index
    ch_reads = channel.fromPath("${projectDir}/data/in.txt")
    ALL_INPUTS(
        channel.of('s1'),
        ch_reads,
        ch_reads,
        channel.of([id: 'm1']).map { m -> tuple(m, file("${projectDir}/data/in.txt"), 'tag') },
        channel.of('a', 'b'),
        channel.of('hi'),
        channel.of('input text'),
    )
    ALL_INPUTS.out.result.view()
    ALL_INPUTS.out.versions.view()
    ALL_INPUTS.out[0].view()
    ALL_INPUTS.out.sample.view()

    // lone and several unnamed outputs
    ONE_UNNAMED(channel.of(1, 2))
    ONE_UNNAMED.out.view()
    MANY_UNNAMED(channel.of('m'))
    MANY_UNNAMED.out[0].view()
    MANY_UNNAMED.out[2].view()

    // a process name in a variable, assigned after the calls, and a ternary over .out
    if (params.flag) {
        runner = ONE_UNNAMED
    }
    else {
        runner = MANY_UNNAMED
    }
    runner.out[0].view()
    ch_pick = params.flag ? ONE_UNNAMED.out : MANY_UNNAMED.out[0]
    ch_pick.view()

    // legacy-only operators and a legacy factory
    ch_nums = channel.of(1, 2, 3, 3)
    ch_nums.first().view()
    ch_nums.last().view()
    ch_nums.concat(channel.of(9)).view()
    ch_nums.collate(2).view()
    ch_nums.distinct().view()
    channel.from(1, 2).view()

    // a multi-output left side spreading over a process's inputs in a pipe, an indexed call result, and | set
    PAIR(channel.of(1)) | JOIN2
    JOIN2.out.view { v -> "spread ${v.trim()}" }
    ch_second = PAIR_B(channel.of(2))[1]
    ch_second.view { v -> "index ${v}" }
    channel.of('w1', 'w2') | map { v -> v.toUpperCase() } | set { ch_w }
    ch_w.view()

    // a legacy subworkflow, read through .out
    SUB(channel.of('n1', 'n2'), params.flag)
    SUB.out.merged.view()
    SUB.out.greeted.view()
}
