// F-108 free-variable probes (LA-27). One workflow per probe: its first statement is the probe and its last statement is the reader line,
// `probe_NN = [every name the probe assigns]`. nextflow lint's "is not defined" errors in the probe are its free reads and
// those in the reader line are the names the probe does not define. Lint errors on purpose; the recorded messages are in
// ../free-variables.json.

workflow P01 {
    r1 = a1 + a1
    probe_01 = [r1]
}

workflow P02 {
    r2 = a2.collect { v -> v + b2 }
    probe_02 = [r2]
}

workflow P03 {
    r3 = a3.collect { it + c3 }
    probe_03 = [r3]
}

workflow P04 {
    if (a4) {
        r4 = 1
    }
    else {
        r4 = 2
    }
    probe_04 = [r4]
}

workflow P05 {
    r5 = "x ${a5} y ${b5.name}"
    probe_05 = [r5]
}

workflow P06 {
    acc6.prop = v6
    probe_06 = []
}

workflow P07 {
    lst7[idx7] = e7
    probe_07 = []
}

workflow P08 {
    lst8 << x8
    probe_08 = []
}

workflow P09 {
    r9 = a9 ? b9 : (c9 ?: d9)
    probe_09 = [r9]
}

workflow P10 {
    r10 = obj10?.p
    probe_10 = [r10]
}

workflow P11 {
    if (a11) {
        def inner11 = b11
        r11 = inner11
    }
    probe_11 = [r11, inner11]
}

workflow P12 {
    try {
        r12 = a12
    }
    catch (Exception e12) {
        r12 = e12.message
    }
    probe_12 = [r12, e12]
}

workflow P13 {
    if (a13) {
        r13 = 1
    }
    else {
        s13 = r13
    }
    probe_13 = [r13, s13]
}

workflow P14 {
    r14 = [k14: a14]
    probe_14 = [r14]
}

workflow P15 {
    r15 = file(a15, checkIfExists: true)
    probe_15 = [r15]
}

workflow P16 {
    r16 = compute16(a16)
    probe_16 = [r16]
}

workflow P17 {
    acc17 += a17
    probe_17 = [acc17]
}

workflow P18 {
    def (p18, q18) = a18
    probe_18 = [p18, q18]
}

workflow P19 {
    (p19, q19) = a19
    probe_19 = [p19, q19]
}

workflow P20 {
    a20.map { v -> v }.set { s20 }
    probe_20 = [s20]
}

workflow P21 {
    a21.tap { t21 }.view()
    probe_21 = [t21]
}

workflow P22 {
    def r22 = a22 + 1
    probe_22 = [r22]
}

workflow P23 {
    r23 = a23.collect { v -> def loc23 = v + b23; loc23 }
    probe_23 = [r23, loc23]
}

workflow P24 {
    r24 = r24 + a24
    probe_24 = [r24]
}

workflow P25 {
    r25 = a25.collect { v -> v.collect { w -> w + v + b25 } }
    probe_25 = [r25]
}

workflow P26 {
    x26.add(y26)
    probe_26 = []
}

workflow P27 {
    assert a27 == b27
    probe_27 = []
}

workflow P28 {
    log.info("v ${a28}")
    probe_28 = []
}

workflow P29 {
    r29 = foo29(a29, flag: c29)
    probe_29 = [r29]
}

workflow P30 {
    if (a30) {
        r30 = 1
    }
    probe_30 = [r30]
}

workflow P31 {
    r31 = a31[0]
    probe_31 = [r31]
}

workflow P32 {
    r32 = a32.b32.c32
    probe_32 = [r32]
}

workflow P33 {
    r33 = a33*.name
    probe_33 = [r33]
}

workflow P34 {
    r34 = workflow.sessionId + a34
    probe_34 = [r34]
}

workflow P35 {
    r35 = a35.collect { it.x35 }
    probe_35 = [r35]
}

workflow P36 {
    r36 = a36.findAll { it > t36 }.size() + params.n36
    probe_36 = [r36]
}

workflow P37 {
    r37 = a37.collect { -> it + b37 }
    probe_37 = [r37]
}
