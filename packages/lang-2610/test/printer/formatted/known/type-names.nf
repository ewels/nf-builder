// Type names print as written; lint -format renames them through the Java class hierarchy (type-rename)
def size(list: List<String>) {
    list.size()
}

def widest() {
    def big = Integer.MAX_VALUE
    def x = Float.parseDouble('1.0')
    def m = new Map()
    def s = [1] as Set
    return [big, x, m, s, m instanceof Map]
}
