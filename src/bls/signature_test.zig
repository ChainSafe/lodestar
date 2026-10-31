//! Tests for `Signature.zig`.

const std = @import("std");
const PublicKey = @import("root.zig").PublicKey;
const AggregateSignature = @import("AggregateSignature.zig");
const Pairing = @import("Pairing.zig");
const SecretKey = @import("SecretKey.zig");
const DST = @import("root.zig").DST;
const Signature_mod = @import("Signature.zig");
const COMPRESS_SIZE = Signature_mod.COMPRESS_SIZE;
const aggregateVerify = Signature_mod.aggregateVerify;
const compress = Signature_mod.compress;
const fromAggregate = Signature_mod.fromAggregate;
const isEqual = Signature_mod.isEqual;
const isInfinity = Signature_mod.isInfinity;
const sigValidate = Signature_mod.sigValidate;
const uncompress = Signature_mod.uncompress;
const verify = Signature_mod.verify;

const ikm: [32]u8 = [_]u8{
    0x93, 0xad, 0x7e, 0x65, 0xde, 0xad, 0x05, 0x2a, 0x08, 0x3a,
    0x91, 0x0c, 0x8b, 0x72, 0x85, 0x91, 0x46, 0x4c, 0xca, 0x56,
    0x60, 0x5b, 0xb0, 0x56, 0xed, 0xfe, 0x2b, 0x60, 0xa6, 0x3c,
    0x48, 0x99,
};

test sigValidate {
    const sk = try SecretKey.keyGen(&ikm, null);
    const signing_root = [_]u8{0x42} ** 32;
    const sig = sk.sign(&signing_root, DST, null);
    const sig_comp = sig.compress();

    const validated = try sigValidate(&sig_comp, true);
    try std.testing.expect(sig.isEqual(&validated));

    var infinity = [_]u8{0} ** COMPRESS_SIZE;
    infinity[0] = 0xc0;
    try std.testing.expectError(error.PkIsInfinity, sigValidate(&infinity, true));
    try std.testing.expect((try sigValidate(&infinity, false)).isInfinity());
}

test uncompress {
    const sk = try SecretKey.keyGen(&ikm, null);
    const signing_root = [_]u8{0x42} ** 32;
    const sig = sk.sign(&signing_root, DST, null);
    const sig_comp = sig.compress();

    // Valid compressed bytes round-trip.
    const sig_uncomp = try uncompress(&sig_comp);
    try std.testing.expect(sig.isEqual(&sig_uncomp));

    // Invalid lengths must be rejected, even with the compression bit set.
    try std.testing.expectError(error.BadEncoding, uncompress(&[_]u8{}));
    try std.testing.expectError(error.BadEncoding, uncompress(sig_comp[0 .. COMPRESS_SIZE - 1]));
    var too_long = [_]u8{0} ** (COMPRESS_SIZE + 1);
    @memcpy(too_long[0..COMPRESS_SIZE], &sig_comp);
    try std.testing.expectError(error.BadEncoding, uncompress(&too_long));

    // Correct length without the compression bit must be rejected.
    var no_comp_bit = sig_comp;
    no_comp_bit[0] &= 0x7f;
    try std.testing.expectError(error.BadEncoding, uncompress(&no_comp_bit));
}

test "test_sign_n_verify" {
    // sample code for consumer like on Readme
    const sk = try SecretKey.keyGen(&ikm, null);
    const pk = sk.toPublicKey();

    const dst = DST;
    const signing_root = [_]u8{0x42} ** 32;
    const sig = sk.sign(&signing_root, dst, null);

    // aug is null
    try sig.verify(
        true,
        &signing_root,
        dst,
        null,
        &pk,
        true,
    );
}

test aggregateVerify {
    const dst = DST;
    // aug is null

    const num_sigs = 10;

    var buffer: [Pairing.sizeOf()]u8 align(Pairing.buf_align) = undefined;

    var msgs: [num_sigs][32]u8 = undefined;
    var sks: [num_sigs]SecretKey = undefined;
    var pks: [num_sigs]PublicKey = undefined;
    var sigs: [num_sigs]Signature_mod = undefined;

    for (0..num_sigs) |i| {
        const sk = try SecretKey.keyGen(&ikm, null);
        const pk = sk.toPublicKey();
        const sig = sk.sign(&msgs[i], dst, null);

        sks[i] = sk;
        pks[i] = pk;
        sigs[i] = sig;
    }

    const agg_sig = try AggregateSignature.aggregate(&sigs, false);
    const sig = Signature_mod.fromAggregate(&agg_sig);

    try std.testing.expect(try sig.aggregateVerify(false, &buffer, &msgs, dst, &pks, false));
}
