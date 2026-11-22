workflow{}

output{
foo:Path{path'foo'}
bar:Channel<Path>{path'bar';index{path'index.csv'}}
}
