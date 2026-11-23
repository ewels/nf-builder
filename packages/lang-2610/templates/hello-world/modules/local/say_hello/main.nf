nextflow.enable.types = true

/**
 * Writes a greeting to a text file.
 *
 * @param greeting The text to write.
 * @return The file that holds the greeting.
 */
process SAY_HELLO {
    input:
    greeting: String

    output:
    file('greeting.txt')

    script:
    """
    echo '${greeting}' > greeting.txt
    """
}
