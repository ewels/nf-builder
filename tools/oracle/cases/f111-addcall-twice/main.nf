// F-111 (AR-22): one process called twice in one workflow. Lint accepts it; the run fails with
// "Process 'HELLO' was called twice -- include it with a different alias or call it in a different workflow",
// so AddCall refuses to add the second call.
process HELLO {
    script:
    """
    echo hello
    """

    stub:
    """
    echo hello
    """
}

workflow {
    HELLO()
    HELLO()
}
