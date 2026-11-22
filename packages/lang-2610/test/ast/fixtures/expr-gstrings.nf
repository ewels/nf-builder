def names = ['Thing 1', 'Thing 2']
println "Hello, ${names.join(' and ')}!"

def name = [first: '<FIRST_NAME>', last: '<LAST_NAME>']
println "Hello, $name.first $name.last!"

def input = 'query.fa'
def output = 'result.html'
def blast_db = 'db'
def command = """
blastp \
    -in $input \
    -out $output \
    -db $blast_db \
    -html
"""
