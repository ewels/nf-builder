def myList = [1, 2, 3]
def myFile = file('hello.txt')
def myFiles = [myFile]
println myList[0]
println myList[0, 1]
println myFile.text       // dot
println myFiles*.text     // spread dot:  myFiles.collect { myFile -> myFile.text }
println myFile?.text      // safe dot:    myFile != null ? myFile.text : null
println myFile.'name'
