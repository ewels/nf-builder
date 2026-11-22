// Oracle case for spike S3 (F-007, ADR 0010): 500 lines; line 487 uses an undefined variable on purpose.
process STEP_1 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_1.txt"), emit: out

    script:
    def prefix = "step_1"
    """
    echo "${prefix} ${sample}" > step_1.txt
    cat ${reads} >> step_1.txt
    wc -l step_1.txt
    """
}

process STEP_2 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_2.txt"), emit: out

    script:
    def prefix = "step_2"
    """
    echo "${prefix} ${sample}" > step_2.txt
    cat ${reads} >> step_2.txt
    wc -l step_2.txt
    """
}

process STEP_3 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_3.txt"), emit: out

    script:
    def prefix = "step_3"
    """
    echo "${prefix} ${sample}" > step_3.txt
    cat ${reads} >> step_3.txt
    wc -l step_3.txt
    """
}

process STEP_4 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_4.txt"), emit: out

    script:
    def prefix = "step_4"
    """
    echo "${prefix} ${sample}" > step_4.txt
    cat ${reads} >> step_4.txt
    wc -l step_4.txt
    """
}

process STEP_5 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_5.txt"), emit: out

    script:
    def prefix = "step_5"
    """
    echo "${prefix} ${sample}" > step_5.txt
    cat ${reads} >> step_5.txt
    wc -l step_5.txt
    """
}

process STEP_6 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_6.txt"), emit: out

    script:
    def prefix = "step_6"
    """
    echo "${prefix} ${sample}" > step_6.txt
    cat ${reads} >> step_6.txt
    wc -l step_6.txt
    """
}

process STEP_7 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_7.txt"), emit: out

    script:
    def prefix = "step_7"
    """
    echo "${prefix} ${sample}" > step_7.txt
    cat ${reads} >> step_7.txt
    wc -l step_7.txt
    """
}

process STEP_8 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_8.txt"), emit: out

    script:
    def prefix = "step_8"
    """
    echo "${prefix} ${sample}" > step_8.txt
    cat ${reads} >> step_8.txt
    wc -l step_8.txt
    """
}

process STEP_9 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_9.txt"), emit: out

    script:
    def prefix = "step_9"
    """
    echo "${prefix} ${sample}" > step_9.txt
    cat ${reads} >> step_9.txt
    wc -l step_9.txt
    """
}

process STEP_10 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_10.txt"), emit: out

    script:
    def prefix = "step_10"
    """
    echo "${prefix} ${sample}" > step_10.txt
    cat ${reads} >> step_10.txt
    wc -l step_10.txt
    """
}

process STEP_11 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_11.txt"), emit: out

    script:
    def prefix = "step_11"
    """
    echo "${prefix} ${sample}" > step_11.txt
    cat ${reads} >> step_11.txt
    wc -l step_11.txt
    """
}

process STEP_12 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_12.txt"), emit: out

    script:
    def prefix = "step_12"
    """
    echo "${prefix} ${sample}" > step_12.txt
    cat ${reads} >> step_12.txt
    wc -l step_12.txt
    """
}

process STEP_13 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_13.txt"), emit: out

    script:
    def prefix = "step_13"
    """
    echo "${prefix} ${sample}" > step_13.txt
    cat ${reads} >> step_13.txt
    wc -l step_13.txt
    """
}

process STEP_14 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_14.txt"), emit: out

    script:
    def prefix = "step_14"
    """
    echo "${prefix} ${sample}" > step_14.txt
    cat ${reads} >> step_14.txt
    wc -l step_14.txt
    """
}

process STEP_15 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_15.txt"), emit: out

    script:
    def prefix = "step_15"
    """
    echo "${prefix} ${sample}" > step_15.txt
    cat ${reads} >> step_15.txt
    wc -l step_15.txt
    """
}

process STEP_16 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_16.txt"), emit: out

    script:
    def prefix = "step_16"
    """
    echo "${prefix} ${sample}" > step_16.txt
    cat ${reads} >> step_16.txt
    wc -l step_16.txt
    """
}

process STEP_17 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_17.txt"), emit: out

    script:
    def prefix = "step_17"
    """
    echo "${prefix} ${sample}" > step_17.txt
    cat ${reads} >> step_17.txt
    wc -l step_17.txt
    """
}

process STEP_18 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_18.txt"), emit: out

    script:
    def prefix = "step_18"
    """
    echo "${prefix} ${sample}" > step_18.txt
    cat ${reads} >> step_18.txt
    wc -l step_18.txt
    """
}

process STEP_19 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_19.txt"), emit: out

    script:
    def prefix = "step_19"
    """
    echo "${prefix} ${sample}" > step_19.txt
    cat ${reads} >> step_19.txt
    wc -l step_19.txt
    """
}

process STEP_20 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_20.txt"), emit: out

    script:
    def prefix = "step_20"
    """
    echo "${prefix} ${sample}" > step_20.txt
    cat ${reads} >> step_20.txt
    wc -l step_20.txt
    """
}

process STEP_21 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_21.txt"), emit: out

    script:
    def prefix = "step_21"
    """
    echo "${prefix} ${sample}" > step_21.txt
    cat ${reads} >> step_21.txt
    wc -l step_21.txt
    """
}

process STEP_22 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_22.txt"), emit: out

    script:
    def prefix = "step_22"
    """
    echo "${prefix} ${sample}" > step_22.txt
    cat ${reads} >> step_22.txt
    wc -l step_22.txt
    """
}

process STEP_23 {
    tag "${sample}"
    cpus 1
    memory '1 GB'

    input:
    tuple val(sample), path(reads)

    output:
    tuple val(sample), path("step_23.txt"), emit: out

    script:
    def prefix = "step_23"
    """
    echo "${prefix} ${sample}" > step_23.txt
    cat ${reads} >> step_23.txt
    wc -l step_23.txt
    """
}

workflow {
    ch_input = channel.of(['a', file('a.txt')], ['b', file('b.txt')])
    STEP_1(ch_input)
    STEP_2(STEP_1.out.out)
    STEP_3(STEP_2.out.out)
    STEP_4(STEP_3.out.out)
    STEP_5(STEP_4.out.out)
    STEP_6(STEP_5.out.out)
    STEP_7(STEP_6.out.out)
    STEP_8(STEP_7.out.out)
    STEP_9(STEP_8.out.out)
    STEP_10(STEP_9.out.out)
    STEP_11(STEP_10.out.out)
    STEP_12(STEP_11.out.out)
    STEP_13(STEP_12.out.out)
    STEP_14(STEP_13.out.out)
    STEP_15(STEP_14.out.out)
    STEP_16(STEP_15.out.out)
    STEP_17(STEP_16.out.out)
    STEP_18(STEP_17.out.out)
    STEP_19(STEP_18.out.out)
    STEP_20(STEP_19.out.out)
    STEP_21(STEP_20.out.out)
    STEP_22(STEP_21.out.out)
    STEP_23(STEP_22.out.out)
    undefined_channel.view()
    // padding to 500 lines (488)
    // padding to 500 lines (489)
    // padding to 500 lines (490)
    // padding to 500 lines (491)
    // padding to 500 lines (492)
    // padding to 500 lines (493)
    // padding to 500 lines (494)
    // padding to 500 lines (495)
    // padding to 500 lines (496)
    // padding to 500 lines (497)
    // padding to 500 lines (498)
    STEP_23.out.out.view()
}
