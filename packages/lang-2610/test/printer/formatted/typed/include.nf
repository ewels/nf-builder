include { helper } from './lib/a.nf'
include { helper as h2 ; other } from "./lib/a.nf"
include {
    helper as h3 ;
    other as o3
} from './lib/a.nf' // multi-line
include { third } from './lib/b.nf'
