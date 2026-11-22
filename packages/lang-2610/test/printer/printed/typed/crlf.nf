def f(x) {
    def s = """
		line 𝐀 one
		  two
	"""
    /* 𝐀 */
    def t = """
    a
      b
    """
    return [s, t] // end
}



// dangling at end
