const ct = @import("consensus_types");

pub const AnyAttestations = union(enum) {
    phase0: ct.phase0.Attestations.Type,
    electra: ct.electra.Attestations.Type,
    gloas: ct.gloas.Attestations.Type,

    pub fn length(self: *const AnyAttestations) usize {
        return switch (self.*) {
            inline else => |attestations| attestations.items.len,
        };
    }

    pub fn items(self: *const AnyAttestations) AnyAttestationItems {
        return switch (self.*) {
            .phase0 => |attestations| .{ .phase0 = attestations.items },
            .electra => |attestations| .{ .electra = attestations.items },
            .gloas => |attestations| .{ .gloas = attestations.items },
        };
    }
};

pub const AnyAttestationItems = union(enum) {
    phase0: []ct.phase0.Attestation.Type,
    electra: []ct.electra.Attestation.Type,
    gloas: []ct.gloas.Attestation.Type,
};
