//! AggregatePublicKey definition for BLS signature scheme based on BLS12-381.
const Self = @This();

/// An aggregate public key that can be used to verify aggregate signatures.
point: c.blst_p1 = c.blst_p1{},

/// A public key paired with its fixed-width random aggregation coefficient.
pub const RandomizedPublicKey = struct {
    public_key: *const PublicKey,
    randomness: [32]u8,
};

/// Converts an aggregate public key back to a regular public key.
/// This converts from projective coordinates back to affine coordinates.
pub fn toPublicKey(self: *const Self) PublicKey {
    var pk = PublicKey{};
    c.blst_p1_to_affine(&pk.point, &self.point);
    return pk;
}

/// Aggregate a single public key into an aggregate public key.
pub fn add(self: *Self, other: *const PublicKey) void {
    c.blst_p1_add_or_double_affine(&self.point, &self.point, &other.point);
}

/// Aggregates multiple public keys into a single aggregate public key.
/// If pks_validate is true, validates each public key before aggregation.
///
/// Returns an error if the slice is empty or if any public key validation fails.
pub fn aggregate(pks: []const PublicKey, pks_validate: bool) BlstError!Self {
    if (pks.len == 0) return error.AggrTypeMismatch;
    if (pks_validate) for (pks) |pk| try pk.validate();

    var agg_pk = Self{};
    c.blst_p1_from_affine(&agg_pk.point, &pks[0].point);
    for (1..pks.len) |i| {
        c.blst_p1_add_or_double_affine(&agg_pk.point, &agg_pk.point, &pks[i].point);
    }
    return agg_pk;
}

test aggregate {
    const ikm: [32]u8 = [_]u8{
        0x93, 0xad, 0x7e, 0x65, 0xde, 0xad, 0x05, 0x2a, 0x08, 0x3a,
        0x91, 0x0c, 0x8b, 0x72, 0x85, 0x91, 0x46, 0x4c, 0xca, 0x56,
        0x60, 0x5b, 0xb0, 0x56, 0xed, 0xfe, 0x2b, 0x60, 0xa6, 0x3c,
        0x48, 0x99,
    };

    const num_sigs = MAX_AGGREGATE_PER_JOB;

    var msgs: [num_sigs][32]u8 = undefined;
    var sks: [num_sigs]SecretKey = undefined;
    var pks: [num_sigs]PublicKey = undefined;
    var sigs: [num_sigs]Signature = undefined;

    for (0..num_sigs) |i| {
        const sk = try SecretKey.keyGen(&ikm, null);
        const pk = sk.toPublicKey();
        const sig = sk.sign(&msgs[i], DST, null);

        sks[i] = sk;
        pks[i] = pk;
        sigs[i] = sig;
    }

    _ = try aggregate(pks[0..], true);
}

const std = @import("std");
const c = @import("root.zig").c;

const blst = @import("root.zig");
const DST = blst.DST;
const MAX_AGGREGATE_PER_JOB = blst.MAX_AGGREGATE_PER_JOB;
const BlstError = @import("error.zig").BlstError;
const PublicKey = @import("root.zig").PublicKey;
const SecretKey = @import("SecretKey.zig");
const Signature = blst.Signature;
