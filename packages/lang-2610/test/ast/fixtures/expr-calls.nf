printf('Hello %s!\n', 'World')
def myFile = file('hello.txt', checkIfExists: true)
def myFiles = [myFile]
myFile.getText()    // dot
myFiles*.getText()  // spread dot:  myFiles.collect { myFile -> myFile.getText() }
myFile?.getText()   // safe dot:    myFile != null ? myFile.getText() : null

// positional args
printf 'Hello %s!\n', 'World'

// positional and named args
file 'hello.txt', checkIfExists: true

// closure arg with additional args
[1, 2, 3].inject('result:') { acc, v -> acc + ' ' + v }

// single closure arg
[1, 2, 3].each() { v -> println v }

// single closure arg without parentheses
[1, 2, 3].each { v -> println v }

println(myFile.size(),)
