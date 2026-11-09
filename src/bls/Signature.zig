//! BLS signatures in the 'minimal-pubkey-size' setting.
//!
//! In this setting, a `Signature` is `p2_affine` point.
//! Source: https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-bls-signature-00#section-2.1

point: c.blst_p2_affine = c.blst_p2_affine{},

const Self = @This();

pub const SERIALIZE_SIZE = 192;
pub const COMPRESS_SIZE = 96;

/// Checks that the signature is not infinity and is in the correct subgroup.
/// Validating prior to verification avoids resource-consuming verification process.
/// Passing 'false' is always cryptographically safe, but application might want
/// to guard against obviously bogus individual signatures.
///
/// Returns `BlstError` if validation fails.
pub fn validate(self: *const Self, sig_infcheck: bool) BlstError!void {
    if (sig_infcheck and c.blst_p2_affine_is_inf(&self.point)) return error.PkIsInfinity;
    if (!c.blst_p2_affine_in_g2(&self.point)) return error.PointNotInGroup;
}

/// Validate a serialized signature.
///
/// Returns the `Signature` on success, `BlstError` on failure.
pub fn sigValidate(signature: []const u8, sig_infcheck: bool) BlstError!Self {
    const sig = try Self.deserialize(signature);
    try sig.validate(sig_infcheck);
    return sig;
}

/// Verify the `Signature` against a `PublicKey` and message.
///
/// Returns `BlstError` if verification fails.
pub fn verify(
    self: *const Self,
    sig_groupcheck: bool,
    msg: *const SigningRoot,
    dst: []const u8,
    aug: ?[]const u8,
    pk: *const PublicKey,
    pk_validate: bool,
) BlstError!void {
    if (sig_groupcheck) try self.validate(false);
    if (pk_validate) try pk.validate();

    if (dst.len == 0) {
        return error.BadEncoding;
    }

    const chk = errorFromInt(c.blst_core_verify_pk_in_g1(
        @ptrCast(&pk.point),
        &self.point,
        true,
        msg,
        @sizeOf(SigningRoot),
        dst.ptr,
        dst.len,
        if (aug) |a| a.ptr else null,
        if (aug) |a| a.len else 0,
    ));

    return chk;
}

/// Verify an `AggregateSignature` against a single message and a slice of `PublicKey`.
///
/// Returns true if verification succeeds, false if verification fails, `BlstError` on error.
pub fn aggregateVerify(
    self: *const Self,
    sig_groupcheck: bool,
    buffer: *align(Pairing.buf_align) [Pairing.sizeOf()]u8,
    msgs: []const SigningRoot,
    dst: []const u8,
    pks: []const PublicKey,
    pks_validate: bool,
) BlstError!bool {
    const n_elems = pks.len;
    if (n_elems == 0 or msgs.len != n_elems) {
        return error.VerifyFail;
    }
    var pairing = Pairing.init(buffer, true, dst);
    try pairing.aggregate(
        &pks[0],
        pks_validate,
        self,
        sig_groupcheck,
        &msgs[0],
        null,
    );

    for (1..n_elems) |i| {
        try pairing.aggregate(
            &pks[i],
            pks_validate,
            null,
            sig_groupcheck,
            &msgs[i],
            null,
        );
    }

    pairing.commit();
    var gtsig = c.blst_fp12{};
    Pairing.aggregated(&gtsig, self);

    return pairing.finalVerify(&gtsig);
}

/// Fast verify an `AggregateSignature` against a single message and a slice of `PublicKey`.
///
/// Returns true if verification succeeds, false if verification fails, `BlstError` on error.
pub fn fastAggregateVerify(
    self: *const Self,
    sig_groupcheck: bool,
    buffer: *align(Pairing.buf_align) [Pairing.sizeOf()]u8,
    msg: *const SigningRoot,
    dst: []const u8,
    pks: []const PublicKey,
    pks_validate: bool,
) BlstError!bool {
    const agg_pk = try AggregatePublicKey.aggregate(pks, pks_validate);
    const pk = agg_pk.toPublicKey();

    return try self.aggregateVerify(
        sig_groupcheck,
        buffer,
        @ptrCast(msg),
        dst,
        &[_]PublicKey{pk},
        false,
    );
}

/// Fast verify an `AggregateSignature` against a single message and pre-aggregated `PublicKey`.
///
/// Returns `BlstError` if verification fails.
pub fn fastAggregateVerifyPreAggregated(
    self: *const Self,
    sig_groupcheck: bool,
    buffer: *align(Pairing.buf_align) [Pairing.sizeOf()]u8,
    msg: *const SigningRoot,
    dst: []const u8,
    pk: *const PublicKey,
) BlstError!bool {
    const pks: [*]const PublicKey = @ptrCast(pk);
    return try self.aggregateVerify(
        sig_groupcheck,
        buffer,
        @as([*]const SigningRoot, @ptrCast(msg))[0..1],
        dst,
        pks[0..1],
        false,
    );
}

/// Convert an `AggregateSignature` to a regular `Signature`.
pub fn fromAggregate(agg_sig: *const AggregateSignature) Self {
    var sig = Self{};
    c.blst_p2_to_affine(&sig.point, &agg_sig.point);
    return sig;
}

/// Compress the `Signature` to bytes.
pub fn compress(self: *const Self) [COMPRESS_SIZE]u8 {
    var sig_comp = [_]u8{0} ** COMPRESS_SIZE;
    c.blst_p2_affine_compress(&sig_comp, &self.point);
    return sig_comp;
}

/// Serialize the `Signature` to bytes.
pub fn serialize(self: *const Self) [SERIALIZE_SIZE]u8 {
    var sig_out = [_]u8{0} ** SERIALIZE_SIZE;
    c.blst_p2_affine_serialize(&sig_out, &self.point);
    return sig_out;
}

/// Decompress a `Signature` from compressed bytes.
///
/// Returns `Signature` on success, `BlstError` on failure.
pub fn uncompress(sig_comp: []const u8) BlstError!Self {
    if (sig_comp.len == COMPRESS_SIZE and (sig_comp[0] & 0x80) != 0) {
        var sig = Self{};
        try errorFromInt(c.blst_p2_uncompress(&sig.point, &sig_comp[0]));
        return sig;
    }

    return error.BadEncoding;
}

/// Deserialize a `Signature` from bytes.
///
/// Returns `Signature` on success, `BlstError` on failure.
pub fn deserialize(sig_in: []const u8) BlstError!Self {
    if ((sig_in.len == SERIALIZE_SIZE and (sig_in[0] & 0x80) == 0) or
        (sig_in.len == COMPRESS_SIZE and (sig_in[0] & 0x80) != 0))
    {
        var sig = Self{};
        try errorFromInt(c.blst_p2_deserialize(&sig.point, &sig_in[0]));
        return sig;
    }

    return error.BadEncoding;
}

/// Check if the `Signature` is in the correct subgroup.
pub fn subgroupCheck(self: *const Self) bool {
    return c.blst_p2_affine_in_g2(&self.point);
}

/// Check if the `Signature` is the point at infinity.
pub fn isInfinity(self: *const Self) bool {
    return c.blst_p2_affine_is_inf(&self.point);
}

/// Check if two signatures are equal.
pub fn isEqual(self: *const Self, other: *const Self) bool {
    return c.blst_p2_affine_is_equal(&self.point, &other.point);
}

const c = @import("root.zig").c;

const BlstError = @import("error.zig").BlstError;
const errorFromInt = @import("error.zig").errorFromInt;
const PublicKey = @import("root.zig").PublicKey;
const SigningRoot = @import("root.zig").SigningRoot;
const AggregatePublicKey = @import("AggregatePublicKey.zig");
const AggregateSignature = @import("AggregateSignature.zig");
const Pairing = @import("Pairing.zig");

test {
    _ = @import("signature_test.zig");
}
