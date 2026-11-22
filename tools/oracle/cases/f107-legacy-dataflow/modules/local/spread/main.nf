// F-107: two processes with two outputs (a legacy process is called once) and one with two inputs, for a pipe that
// spreads the left side over the inputs (docs/workflow.mdx#L666-L723) and for `CALL(...)[n]`
// (docs/process.mdx#L1065-L1089).
process PAIR {
    input:
    val x

    output:
    val x, emit: first
    val 'second', emit: second

    exec:
    true
}

process PAIR_B {
    input:
    val x

    output:
    val x, emit: first
    val 'second', emit: second

    exec:
    true
}

process JOIN2 {
    input:
    val p
    val q

    output:
    stdout

    script:
    "echo ${p} ${q}"

    stub:
    "echo ${p} ${q}"
}
