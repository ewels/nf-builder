nextflow.enable.types=true

process hello{
input: record(id:String,infile:Path) ; script: 'cat input.txt > output.txt'
}
