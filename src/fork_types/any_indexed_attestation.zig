const ct = @import("consensus_types");

pub const AnyIndexedAttestation = union(enum) {
    phase0: *ct.phase0.IndexedAttestation.Type,
    electra: *ct.electra.IndexedAttestation.Type,
    gloas: *ct.gloas.IndexedAttestation.Type,

    /// Get the attestation data (same struct in both forks).
    pub fn attestationData(self: *const AnyIndexedAttestation) ct.phase0.AttestationData.Type {
        return switch (self.*) {
            inline else => |att| att.data,
        };
    }

    /// Get attesting indices as a slice (different max lengths per fork).
    pub fn attestingIndices(self: *const AnyIndexedAttestation) []const ct.primitive.ValidatorIndex.Type {
        return switch (self.*) {
            inline else => |att| att.attesting_indices.items,
        };
    }

    /// Get the beacon block root from attestation data.
    pub fn beaconBlockRoot(self: *const AnyIndexedAttestation) ct.primitive.Root.Type {
        return switch (self.*) {
            inline else => |att| att.data.beacon_block_root,
        };
    }

    /// Get the target epoch from attestation data.
    pub fn targetEpoch(self: *const AnyIndexedAttestation) ct.primitive.Epoch.Type {
        return switch (self.*) {
            inline else => |att| att.data.target.epoch,
        };
    }

    /// Get the target root from attestation data.
    pub fn targetRoot(self: *const AnyIndexedAttestation) ct.primitive.Root.Type {
        return switch (self.*) {
            inline else => |att| att.data.target.root,
        };
    }

    /// Get the slot from attestation data.
    pub fn slot(self: *const AnyIndexedAttestation) ct.primitive.Slot.Type {
        return switch (self.*) {
            inline else => |att| att.data.slot,
        };
    }

    /// Get the committee index from attestation data.
    pub fn index(self: *const AnyIndexedAttestation) ct.primitive.CommitteeIndex.Type {
        return switch (self.*) {
            inline else => |att| att.data.index,
        };
    }
};
