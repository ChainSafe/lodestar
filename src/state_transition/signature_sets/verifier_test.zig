//! Tests for `verifier.zig`.

const std = @import("std");
const bls = @import("bls");
const Signature = bls.Signature;
const ThreadPool = bls.ThreadPool;
const DST = bls.DST;
const SameMessageSignatureSetBatch = @import("verifier.zig").SameMessageSignatureSetBatch;
const SignatureSetBatch = @import("verifier.zig").SignatureSetBatch;

test "single signature set verification" {
    const ikm = [_]u8{2} ** 32;
    const message = [_]u8{3} ** 32;
    const secret_key = try bls.SecretKey.keyGen(&ikm, null);
    const public_key = secret_key.toPublicKey();
    const signature = secret_key.sign(&message, DST, null).compress();
    const pool = try ThreadPool.init(std.testing.allocator, std.testing.io, .{ .n_workers = 1 });
    defer pool.deinit(std.testing.io);

    var batch: SignatureSetBatch(1) = .{};
    try std.testing.expect(batch.append(&public_key, &message, &signature));
    try std.testing.expect(try batch.verify(std.testing.io, pool));
}

test "same-message verification falls back around malformed signatures" {
    const ikm = [_]u8{4} ** 32;
    const message = [_]u8{5} ** 32;
    const secret_key = try bls.SecretKey.keyGen(&ikm, null);
    const public_key = secret_key.toPublicKey();
    const signature = secret_key.sign(&message, DST, null).compress();
    const malformed_signature = [_]u8{0} ** Signature.COMPRESS_SIZE;
    const pool = try ThreadPool.init(std.testing.allocator, std.testing.io, .{ .n_workers = 1 });
    defer pool.deinit(std.testing.io);

    var batch: SameMessageSignatureSetBatch(2) = .{};
    batch.append(&public_key, &signature);
    batch.append(&public_key, &malformed_signature);

    var results: [2]bool = undefined;
    try batch.verify(std.testing.io, pool, &message, &results);
    try std.testing.expectEqualSlices(bool, &.{ true, false }, &results);
}
