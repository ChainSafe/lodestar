const ct = @import("consensus_types");

const ValidatorIndex = ct.primitive.ValidatorIndex.Type;

pub const AnyAttesterSlashing = union(enum) {
    phase0: *ct.phase0.AttesterSlashing.Type,
    electra: *ct.electra.AttesterSlashing.Type,
    gloas: *ct.gloas.AttesterSlashing.Type,

    /// Get attesting indices from attestation_1.
    pub fn attestingIndices1(self: *const AnyAttesterSlashing) []const ValidatorIndex {
        return switch (self.*) {
            inline else => |s| s.attestation_1.attesting_indices.items,
        };
    }

    /// Get attesting indices from attestation_2.
    pub fn attestingIndices2(self: *const AnyAttesterSlashing) []const ValidatorIndex {
        return switch (self.*) {
            inline else => |s| s.attestation_2.attesting_indices.items,
        };
    }
};

pub const AnyAttesterSlashings = union(enum) {
    phase0: ct.phase0.AttesterSlashings.Type,
    electra: ct.electra.AttesterSlashings.Type,
    gloas: ct.gloas.AttesterSlashings.Type,

    pub fn length(self: *const AnyAttesterSlashings) usize {
        return switch (self.*) {
            inline else => |attester_slashings| attester_slashings.items.len,
        };
    }

    pub fn items(self: *const AnyAttesterSlashings) AnyAttesterSlashingItems {
        return switch (self.*) {
            .phase0 => |attester_slashings| .{ .phase0 = attester_slashings.items },
            .electra => |attester_slashings| .{ .electra = attester_slashings.items },
            .gloas => |attester_slashings| .{ .gloas = attester_slashings.items },
        };
    }
};

pub const AnyAttesterSlashingItems = union(enum) {
    phase0: []ct.phase0.AttesterSlashing.Type,
    electra: []ct.electra.AttesterSlashing.Type,
    gloas: []ct.gloas.AttesterSlashing.Type,
};
