// Type names print as written; lint -format renames them through the Java class hierarchy (type-rename)
def size(list: ArrayList<String>) {
    list.size()
}

def widest() {
    def big = Long.MAX_VALUE
    def x = Double.parseDouble('1.0')
    def m = new LinkedHashMap()
    def s = [1] as TreeSet
    return [big, x, m, s, m instanceof LinkedHashMap]
}
