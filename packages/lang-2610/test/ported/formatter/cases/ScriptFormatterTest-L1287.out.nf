workflow {
    ch = channel.fromFilePairs("${params.dir}/*.vcf.gz")
    url = "${params.host}//path"
}
