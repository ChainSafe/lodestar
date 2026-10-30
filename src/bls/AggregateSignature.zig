//! AggregateSignature definition for BLS signature scheme using BLS12-381.
const Self = @This();

/// An aggregate signature that can be used to verify multiple messages
/// against an aggregate public key.
point: c.blst_p2 = c.blst_p2{},

/// A signature paired with its fixed-width random aggregation coefficient.
pub const RandomizedSignature = struct {
    signature: *const Signature,
    randomness: [32]u8,
};

/// Validates that the aggregate signature is in the correct subgroup (G2).
pub fn validate(self: *const Self) BlstError!void {
    if (!c.blst_p2_in_g2(&self.point)) return error.PointNotInGroup;
}

/// Converts an aggregate signature back to a regular signature.
/// Converts from projective coordinates back to affine coordinates.
pub fn toSignature(self: *const Self) Signature {
    var sig = Signature{};
    c.blst_p2_to_affine(@ptrCast(&sig.point), &self.point);
    return sig;
}

/// Aggregates multiple signatures into a single aggregate signature.
///
/// Validates each signature before aggregation if `sigs_groupcheck` is true.
/// Errors if the `sigs` slice is empty or if any signature validation fails.
pub fn aggregate(sigs: []const Signature, sigs_groupcheck: bool) BlstError!Self {
    if (sigs.len == 0) return error.AggrTypeMismatch;
    if (sigs_groupcheck) for (sigs) |sig| try sig.validate(false);

    var agg_sig = Self{};
    c.blst_p2_from_affine(&agg_sig.point, @ptrCast(&sigs[0].point));
    for (1..sigs.len) |i| {
        c.blst_p2_add_or_double_affine(&agg_sig.point, &agg_sig.point, &sigs[i].point);
    }

    return agg_sig;
}

const std = @import("std");
const c = @import("root.zig").c;

const BlstError = @import("error.zig").BlstError;
const blst = @import("root.zig");
const Signature = blst.Signature;
const SecretKey = @import("SecretKey.zig");
const PublicKey = @import("root.zig").PublicKey;
const AggregatePublicKey = @import("AggregatePublicKey.zig");
const DST = blst.DST;
const MAX_AGGREGATE_PER_JOB = blst.MAX_AGGREGATE_PER_JOB;
