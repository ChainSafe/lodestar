//! Minimal abstraction around the `bls` module.
//!
//! Consumers should use bls within state transition without having to
//! deal with setting some common defaults for parameters, such as:
//!
//! 1) [Domain Separation Tag], or `dst`, which determines a unique hash-to-point
//! function. This is set to `bls.DST` by functions within the `bls` module.
//!
//! 2) [Augmentation], or `aug`, which decides if we sign pubkey || message instead of
//! just message. Since Ethereum uses proof-of-posession we do not use `aug`.
//!
//! [Domain Separation Tag]: https://www.ietf.org/archive/id/draft-irtf-cfrg-bls-signature-06.html#section-4.2.3-3
//! [Augmentation]: https://www.ietf.org/archive/id/draft-irtf-cfrg-bls-signature-06.html#name-message-augmentation
const std = @import("std");
const bls = @import("bls");
const PublicKey = bls.PublicKey;
const Signature = bls.Signature;
const SecretKey = bls.SecretKey;
const SigningRoot = bls.SigningRoot;

const BlsOpts = struct {
    /// Decides whether the signature should be group checked.
    sig_groupcheck: bool = false,
    /// Decides if the public key will be infinity checked and group checked.
    pk_validate: bool = false,
};

pub fn sign(sk: SecretKey, msg: *const SigningRoot) Signature {
    return sk.sign(msg, bls.DST, null);
}

/// Verify a signature against a message and public key.
pub fn verify(
    msg: *const SigningRoot,
    pk: *const PublicKey,
    sig: *const Signature,
    opts: BlsOpts,
) bls.BlstError!void {
    try sig.verify(opts.sig_groupcheck, msg, bls.DST, null, pk, opts.pk_validate);
}

pub fn fastAggregateVerify(
    msg: *const SigningRoot,
    pks: []const PublicKey,
    sig: *const Signature,
    opts: BlsOpts,
) !bool {
    var pairing_buf: [bls.Pairing.sizeOf()]u8 align(bls.Pairing.buf_align) = undefined;
    return sig.fastAggregateVerify(
        opts.sig_groupcheck,
        &pairing_buf,
        msg,
        bls.DST,
        pks,
        opts.pk_validate,
    ) catch return false;
}

test "bls - sanity" {
    const ikm: [32]u8 = [_]u8{
        0x93, 0xad, 0x7e, 0x65, 0xde, 0xad, 0x05, 0x2a, 0x08, 0x3a,
        0x91, 0x0c, 0x8b, 0x72, 0x85, 0x91, 0x46, 0x4c, 0xca, 0x56,
        0x60, 0x5b, 0xb0, 0x56, 0xed, 0xfe, 0x2b, 0x60, 0xa6, 0x3c,
        0x48, 0x99,
    };
    const sk = try SecretKey.keyGen(ikm[0..], null);
    const msg = [_]u8{1} ** 32;
    const sig = sign(sk, &msg);
    const pk = sk.toPublicKey();
    try verify(&msg, &pk, &sig, .{});

    var pks = [_]PublicKey{pk};
    var pks_slice: []const PublicKey = pks[0..1];
    const result = try fastAggregateVerify(&msg, pks_slice[0..], &sig, .{});
    try std.testing.expect(result);
}
