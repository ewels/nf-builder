def x = Math.random()
if (x < 0.5) {
    println('You lost.')
}
else {
    println('You won!')
}

def grade = 89
if (grade >= 90) {
    println('You get an A!')
}
else if (grade >= 80) {
    println('You get a B!')
}
else if (grade >= 70) {
    println('You get a C!')
}
else if (grade >= 60) {
    println('You get a D!')
}
else {
    println('You failed.')
}
