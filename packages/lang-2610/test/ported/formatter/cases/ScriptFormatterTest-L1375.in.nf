workflow {
  channel.of(1).map { v -> v }.view { """
  value: ${v}
  """ }
}
