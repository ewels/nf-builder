// F-206 (UX-30, LA-20): a typed process with a documented description, four directives (one value longer than 60
// characters), a topic section, and a script of more than eight lines.
nextflow.enable.types = true

/**
 * Trims a name and greets it.
 *
 * Runs once per name and writes the greeting to standard output.
 *
 * @param name the name to trim
 * @param greeting the greeting to prepend
 * @return the trimmed greeting
 */
process TRIM {
    tag "${name}"
    label 'process_single'
    cpus 1
    container 'quay.io/biocontainers/coreutils:9.5--0123456789abcdef0123456789abcdef01234567'

    input:
    name: String
    greeting: String

    output:
    line: String = stdout()

    topic:
    tuple('trim', '1.0') >> 'versions'

    script:
    """
    set -eu
    trimmed=\$(echo '${name}' | tr -d ' ')
    upper=\$(echo "\$trimmed" | tr 'a-z' 'A-Z')
    lower=\$(echo "\$trimmed" | tr 'A-Z' 'a-z')
    length=\${#trimmed}
    echo "name: \$trimmed" >&2
    echo "upper: \$upper" >&2
    echo "lower: \$lower" >&2
    echo "length: \$length" >&2
    echo '${greeting} ${name}'
    """

    stub:
    """
    echo '${greeting} ${name}'
    """
}
