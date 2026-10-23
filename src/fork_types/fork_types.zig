const ct = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;

pub fn ForkTypes(comptime fork: ForkSeq) type {
    return switch (fork) {
        .phase0 => ct.phase0,
        .altair => ct.altair,
        .bellatrix => ct.bellatrix,
        .capella => ct.capella,
        .deneb => ct.deneb,
        .electra => ct.electra,
        .fulu => ct.fulu,
        .gloas => ct.gloas,
        .heze => ct.heze,
    };
}
