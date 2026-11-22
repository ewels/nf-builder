// Malformed on purpose: process LATE_INPUT declares input: after script:, so its section labels are out of order.
process LATE_INPUT {
    script:
    """
    echo '${greeting}'
    """

    input:
    val greeting
}

process ON_TIME {
    input:
    val greeting

    output:
    stdout

    script:
    """
    echo '${greeting}'
    """
}
