//! Tests for `verifier.zig`.

const std = @import("std");
const bls = @import("root.zig");
const PublicKey = bls.PublicKey;
const Signature = bls.Signature;
const ThreadPool = bls.ThreadPool;
const BatchVerifyItem = bls.BatchVerifyItem;
const DST = bls.DST;
const MAX_AGGREGATE_PER_JOB = bls.MAX_AGGREGATE_PER_JOB;
const verifySameMessage = @import("verifier.zig").verifySameMessage;
const verifySignatureSets = @import("verifier.zig").verifySignatureSets;

test "single signature set verification" {
    const ikm = [_]u8{1} ** 32;
    var message = [_]u8{2} ** 32;
    const secret_key = try bls.SecretKey.keyGen(&ikm, null);
    const public_key = secret_key.toPublicKey();
    const signature = secret_key.sign(&message, DST, null);
    var items = [_]BatchVerifyItem{.{
        .message = &message,
        .public_key = &public_key,
        .signature = &signature,
        .randomness = undefined,
    }};

    const pool = try ThreadPool.init(std.testing.allocator, std.testing.io, .{ .n_workers = 1 });
    defer pool.deinit(std.testing.io);

    try std.testing.expect(try verifySignatureSets(
        std.testing.io,
        pool,
        &items,
        .{ .pks_validate = true, .sigs_groupcheck = true },
    ));

    message = [_]u8{3} ** 32;
    try std.testing.expect(!try verifySignatureSets(
        std.testing.io,
        pool,
        &items,
        .{ .pks_validate = true, .sigs_groupcheck = true },
    ));
}

test "same-message verification rejects invalid set counts" {
    var empty_public_keys = [_]*const PublicKey{};
    var empty_signatures = [_]*const Signature{};
    const message = [_]u8{0} ** 32;
    const pool: *ThreadPool = undefined;

    try std.testing.expectError(
        error.InvalidLength,
        verifySameMessage(
            std.testing.io,
            pool,
            &empty_public_keys,
            &empty_signatures,
            &message,
        ),
    );

    const too_many = MAX_AGGREGATE_PER_JOB + 1;
    var public_keys: [too_many]*const PublicKey = undefined;
    var signatures: [too_many]*const Signature = undefined;
    try std.testing.expectError(
        error.TooManySignatureSets,
        verifySameMessage(
            std.testing.io,
            pool,
            &public_keys,
            &signatures,
            &message,
        ),
    );
}
