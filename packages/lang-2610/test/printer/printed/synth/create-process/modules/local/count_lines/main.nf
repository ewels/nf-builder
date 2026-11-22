nextflow.enable.types = true

/**
 * Count the lines of a file.
 */
process COUNT_LINES {
    input:
    record(
        id: String,
        text: Path
    )

    output:
    lines: Path = file('lines.txt')

    script:
    """
    wc -l ${text} > lines.txt
    """
}

record Counted {
    id: String
    lines: Path
}
