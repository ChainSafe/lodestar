//! Pairing context for bilinear pairing operations.
ctx: *c.blst_pairing,

const Self = @This();

/// Required alignment for the pairing buffer. The opaque C struct contains
/// `uptr_t` (64-bit) fields that require 8-byte alignment.
pub const buf_align = 8;

/// Initializes a pairing context with the provided `buffer` and other parameters.
/// This `Pairing` instance owns the given memory.
///
/// Note: Rust always use a heap allocation here, but adding an allocator as param for Zig is too complex
/// instead of that we provide a buffer that's big enough for the struct to operate on so that:
/// - it does not have allocator in its api
/// - can use stack allocation at consumer side
/// - can reuse memory if it makes sense at consumer side
pub fn init(buffer: *align(buf_align) [Self.sizeOf()]u8, hash_or_encode: bool, dst: []const u8) Self {
    const obj = Self{ .ctx = @ptrCast(buffer) };
    c.blst_pairing_init(obj.ctx, hash_or_encode, @ptrCast(dst.ptr), dst.len);

    return obj;
}

/// Calculates the size of the internal (opaque) C type here in order to compute the pairing size at comptime.
///
/// This is safe because blst is statically linked to this binding.
pub fn sizeOf() usize {
    const vec384_size = 384 / std.mem.byte_size_in_bits;
    const vec384fp12_size = vec384_size * 12;

    const point_e1_affine_size = vec384_size * 2;
    const point_e2_size = vec384_size * 2 * 3;
    const point_e2_affine_size = vec384_size * 2 * 2;

    const N_MAX = 8;

    const p: usize =
        @sizeOf(c_int) * 2 + // ctrl and nelems
        @sizeOf(usize) * 2 + // DST and DST_len
        vec384fp12_size + // GT
        point_e2_size + // AggrSignaturen
        point_e2_affine_size * N_MAX + // Q
        point_e1_affine_size * N_MAX; // P

    // Same 8-byte rounding as the library
    return (p + 7) & ~@as(usize, 7);
}

/// Aggregates a `PublicKey` and `Signature` into the pairing context.
pub fn aggregate(
    self: *Self,
    pk: *const PublicKey,
    pk_validate: bool,
    sig: ?*const Signature,
    sig_groupcheck: bool,
    msg: *const SigningRoot,
    aug: ?[]const u8,
) BlstError!void {
    try errorFromInt(
        c.blst_pairing_chk_n_aggr_pk_in_g1(
            self.ctx,
            &pk.point,
            pk_validate,
            if (sig) |s| &s.point else null,
            sig_groupcheck,
            msg,
            @sizeOf(SigningRoot),
            if (aug) |a| a.ptr else null,
            if (aug) |a| a.len else 0,
        ),
    );
}

// TODO: msgs and scalar should have len > 0
// check for other apis as well
/// Multiply by `scalar` and aggregate into the pairing context.
pub fn mulAndAggregate(
    self: *Self,
    pk: *const PublicKey,
    pk_validate: bool,
    sig: *const Signature,
    sig_groupcheck: bool,
    scalar: []const u8,
    nbits: usize,
    msg: *const SigningRoot,
) BlstError!void {
    try errorFromInt(
        c.blst_pairing_chk_n_mul_n_aggr_pk_in_g1(
            self.ctx,
            &pk.point,
            pk_validate,
            &sig.point,
            sig_groupcheck,
            scalar.ptr,
            nbits,
            msg,
            @sizeOf(SigningRoot),
            null,
            0,
        ),
    );
}

/// Compute the aggregated signature in G2.
pub fn aggregated(gtsig: *c.blst_fp12, sig: *const Signature) void {
    c.blst_aggregated_in_g2(gtsig, &sig.point);
}

/// Commit and finalize the aggregation in the pairing context.
pub fn commit(self: *Self) void {
    c.blst_pairing_commit(self.ctx);
}

/// Merge another pairing context into this one.
pub fn merge(self: *Self, ctx1: *const Self) BlstError!void {
    try errorFromInt(c.blst_pairing_merge(self.ctx, ctx1.ctx));
}

/// Perform final verification of the pairing.
pub fn finalVerify(self: *const Self, gtsig: ?*const c.blst_fp12) bool {
    return c.blst_pairing_finalverify(self.ctx, gtsig);
}

/// Raw aggregation of points into the pairing context.
pub fn rawAggregate(self: *Self, q: *c.blst_p2_affine, p: *c.blst_p1_affine) void {
    c.blst_pairing_raw_aggregate(self.ctx, q, p);
}

/// Get the pairing context as an FP12 element.
pub fn asFp12(self: *Self) *c.blst_fp12 {
    return c.blst_pairing_as_fp12(self.ctx);
}

const std = @import("std");
const c = @import("root.zig").c;
const BlstError = @import("error.zig").BlstError;
const errorFromInt = @import("error.zig").errorFromInt;
const blst = @import("root.zig");
const PublicKey = blst.PublicKey;
const Signature = blst.Signature;
const SigningRoot = blst.SigningRoot;

test {
    _ = @import("pairing_test.zig");
}
