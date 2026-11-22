process hello {
    task.cpus 2

    script:
    """
    echo hello
    """
}
