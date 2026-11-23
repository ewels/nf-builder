// F-206 (UX-30, LA-20): a legacy process whose output line emits to the versions topic.
process LEGACY_VERSIONS {
    input:
    val greeting

    output:
    stdout
    tuple val("${task.process}"), val('echo'), val('1.0'), topic: versions

    script:
    """
    echo '${greeting}'
    """

    stub:
    """
    echo '${greeting}'
    """
}
