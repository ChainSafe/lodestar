//! Tests for `ThreadPool.zig`.
//! Thread pool for parallel BLS operations.
//!
//! Provides multi-threaded versions of aggregation and verification functions
//! using a persistent pool of worker threads to avoid thread creation overhead.
//!
//! Multiple callers can dispatch work concurrently. Each job owns its own
//! pairing buffers. Workers pull work items from a shared queue and use atomic
//! counters within each job to grab individual signature sets to process,
//! similar to how the Rust `blst` crate's `verify_multiple_aggregate_signatures`
//! works with `threadpool::ThreadPool`.
const ThreadPool = @import("ThreadPool.zig");
const std = @import("std");
const blst = @import("root.zig");
const PublicKey = blst.PublicKey;
const Signature = blst.Signature;
const SigningRoot = blst.SigningRoot;
const AggregateSignature = blst.AggregateSignature;
const fast_verify = @import("fast_verify.zig");
const BatchVerifyItem = fast_verify.BatchVerifyItem;
const SecretKey = @import("SecretKey.zig");
const ThreadPool_mod = @import("ThreadPool.zig");
const aggregateVerify = ThreadPool_mod.aggregateVerify;
const aggregateWithRandomness = ThreadPool_mod.aggregateWithRandomness;
const deinit = ThreadPool_mod.deinit;
const init = ThreadPool_mod.init;
const verifyMultipleAggregateSignatures = ThreadPool_mod.verifyMultipleAggregateSignatures;

test "verifyMultipleAggregateSignatures multi-threaded" {
    const pool = try ThreadPool.init(std.testing.allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);

    const ikm: [32]u8 = .{
        0x93, 0xad, 0x7e, 0x65, 0xde, 0xad, 0x05, 0x2a, 0x08, 0x3a,
        0x91, 0x0c, 0x8b, 0x72, 0x85, 0x91, 0x46, 0x4c, 0xca, 0x56,
        0x60, 0x5b, 0xb0, 0x56, 0xed, 0xfe, 0x2b, 0x60, 0xa6, 0x3c,
        0x48, 0x99,
    };

    const num_sigs = 16;

    var msgs: [num_sigs]SigningRoot = undefined;
    var pks: [num_sigs]PublicKey = undefined;
    var sigs: [num_sigs]Signature = undefined;
    var items: [num_sigs]blst.BatchVerifyItem = undefined;

    var prng = std.Random.DefaultPrng.init(blk: {
        var seed: u64 = undefined;
        std.testing.io.random(std.mem.asBytes(&seed));
        break :blk seed;
    });
    const rand = prng.random();

    for (0..num_sigs) |i| {
        std.Random.bytes(rand, &msgs[i]);
        var ikm_i = ikm;
        ikm_i[0] = @intCast(i & 0xff);
        const sk = try SecretKey.keyGen(&ikm_i, null);
        pks[i] = sk.toPublicKey();
        sigs[i] = sk.sign(&msgs[i], blst.DST, null);
        items[i] = .{
            .message = &msgs[i],
            .public_key = &pks[i],
            .signature = &sigs[i],
            .randomness = undefined,
        };
        std.Random.bytes(rand, &items[i].randomness);
    }

    const result = try pool.verifyMultipleAggregateSignatures(
        std.testing.io,
        &items,
        blst.DST,
        true,
        true,
    );

    try std.testing.expect(result);
}

test "aggregateVerify multi-threaded" {
    const pool = try ThreadPool.init(std.testing.allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);

    const ikm: [32]u8 = .{
        0x93, 0xad, 0x7e, 0x65, 0xde, 0xad, 0x05, 0x2a, 0x08, 0x3a,
        0x91, 0x0c, 0x8b, 0x72, 0x85, 0x91, 0x46, 0x4c, 0xca, 0x56,
        0x60, 0x5b, 0xb0, 0x56, 0xed, 0xfe, 0x2b, 0x60, 0xa6, 0x3c,
        0x48, 0x99,
    };

    const num_sigs = 16;

    var msgs: [num_sigs][32]u8 = undefined;
    var pks: [num_sigs]PublicKey = undefined;
    var sigs: [num_sigs]Signature = undefined;
    var pk_ptrs: [num_sigs]*PublicKey = undefined;

    var prng = std.Random.DefaultPrng.init(blk: {
        var seed: u64 = undefined;
        std.testing.io.random(std.mem.asBytes(&seed));
        break :blk seed;
    });
    const rand = prng.random();

    for (0..num_sigs) |i| {
        std.Random.bytes(rand, &msgs[i]);
        var ikm_i = ikm;
        ikm_i[0] = @intCast(i & 0xff);
        const sk = try SecretKey.keyGen(&ikm_i, null);
        pks[i] = sk.toPublicKey();
        sigs[i] = sk.sign(&msgs[i], blst.DST, null);
        pk_ptrs[i] = &pks[i];
    }

    const agg_sig = blst.AggregateSignature.aggregate(&sigs, false) catch return error.AggregationFailed;
    const final_sig = agg_sig.toSignature();

    try std.testing.expect(try pool.aggregateVerify(
        std.testing.io,
        &final_sig,
        false,
        &msgs,
        blst.DST,
        &pk_ptrs,
        true,
    ));
}

test "aggregateWithRandomness multi-threaded" {
    const pool = try ThreadPool.init(std.testing.allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);

    const ikm: [32]u8 = .{
        0x93, 0xad, 0x7e, 0x65, 0xde, 0xad, 0x05, 0x2a, 0x08, 0x3a,
        0x91, 0x0c, 0x8b, 0x72, 0x85, 0x91, 0x46, 0x4c, 0xca, 0x56,
        0x60, 0x5b, 0xb0, 0x56, 0xed, 0xfe, 0x2b, 0x60, 0xa6, 0x3c,
        0x48, 0x99,
    };

    const num_sigs = blst.MAX_AGGREGATE_PER_JOB;

    var msg: [32]u8 = undefined;
    var pks: [num_sigs]PublicKey = undefined;
    var sigs: [num_sigs]Signature = undefined;
    var pk_ptrs: [num_sigs]*const PublicKey = undefined;
    var sig_ptrs: [num_sigs]*const Signature = undefined;

    var prng = std.Random.DefaultPrng.init(blk: {
        var seed: u64 = undefined;
        std.testing.io.random(std.mem.asBytes(&seed));
        break :blk seed;
    });
    const rand = prng.random();
    std.Random.bytes(rand, &msg);

    for (0..num_sigs) |i| {
        var ikm_i = ikm;
        ikm_i[0] = @intCast(i & 0xff);
        const sk = try SecretKey.keyGen(&ikm_i, null);
        pks[i] = sk.toPublicKey();
        sigs[i] = sk.sign(&msg, blst.DST, null);
        pk_ptrs[i] = &pks[i];
        sig_ptrs[i] = &sigs[i];
    }

    var randomness: [32 * num_sigs]u8 = undefined;
    std.Random.bytes(rand, &randomness);

    var agg_pk: PublicKey = .{};
    var agg_sig: Signature = .{};

    try pool.aggregateWithRandomness(
        std.testing.io,
        &pk_ptrs,
        &sig_ptrs,
        &randomness,
        true,
        true,
        &agg_pk,
        &agg_sig,
    );

    try agg_sig.verify(true, &msg, blst.DST, null, &agg_pk, true);
}
