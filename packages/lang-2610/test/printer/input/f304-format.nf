nextflow.enable.types=true

/**
 * Counts   the lines.
 */
process COUNT {
  tag   'count'
  cpus 2


  input:
  reads: Path
     sample: String

  output:
  total: Path = file('count.txt')

  script:
    """
    wc -l ${reads} > count.txt
    """
}
