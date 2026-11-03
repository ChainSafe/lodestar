const std = @import("std");
const bls = @import("bls");
const types = @import("consensus_types");
const Validator = types.phase0.Validator.Type;
const cache_module = @import("pubkey_cache.zig");
const PubkeyCache = cache_module.PubkeyCache;
const testing = std.testing;
const interop = @import("../test_utils/interop_pubkeys.zig");

fn validatorsForPubkeys(
    pubkeys: []const types.primitive.BLSPubkey.Type,
    validators: []Validator,
    validator_ptrs: []*const Validator,
) void {
    std.debug.assert(pubkeys.len == validators.len);
    std.debug.assert(pubkeys.len == validator_ptrs.len);
    for (pubkeys, validators, validator_ptrs) |pubkey, *validator, *validator_ptr| {
        validator.* = std.mem.zeroes(Validator);
        validator.pubkey = pubkey;
        validator_ptr.* = validator;
    }
}

test "syncPubkeys incrementally populates both lookup directions" {
    const initial_count = 2;
    const total_count = 16;
    var pubkeys: [total_count]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(total_count, &pubkeys);

    var validators: [total_count]Validator = undefined;
    var validator_ptrs: [total_count]*const Validator = undefined;
    validatorsForPubkeys(&pubkeys, &validators, &validator_ptrs);

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();

    try cache.syncPubkeys(testing.io, validator_ptrs[0..initial_count]);
    try cache.syncPubkeys(testing.io, &validator_ptrs);

    try testing.expectEqual(@as(u32, total_count), cache.count(testing.io));
    for (pubkeys, 0..) |pubkey, expected_index| {
        try testing.expectEqual(
            @as(u64, @intCast(expected_index)),
            cache.get(testing.io, pubkey).?,
        );
        const compressed = cache.getPubkey(testing.io, expected_index).?.compress();
        try testing.expectEqualSlices(u8, &pubkey, &compressed);
    }
}

test "syncPubkeys accepts a historical validator slice" {
    var pubkeys: [4]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var validators: [4]Validator = undefined;
    var validator_ptrs: [4]*const Validator = undefined;
    validatorsForPubkeys(&pubkeys, &validators, &validator_ptrs);

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    try cache.syncPubkeys(testing.io, &validator_ptrs);

    try cache.syncPubkeys(testing.io, validator_ptrs[0..2]);

    try testing.expectEqual(@as(u32, validators.len), cache.count(testing.io));
    try testing.expectEqual(@as(u64, 3), cache.get(testing.io, pubkeys[3]).?);
    const future_pubkey = cache.getPubkey(testing.io, 3).?.compress();
    try testing.expectEqualSlices(u8, &pubkeys[3], &future_pubkey);
}

test "syncPubkeys rejects a duplicate without publishing a partial suffix" {
    var pubkeys: [2]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var validators = [_]Validator{
        std.mem.zeroes(Validator),
        std.mem.zeroes(Validator),
        std.mem.zeroes(Validator),
    };
    validators[0].pubkey = pubkeys[0];
    validators[1].pubkey = pubkeys[1];
    validators[2].pubkey = pubkeys[1];
    const validator_ptrs = [_]*const Validator{
        &validators[0],
        &validators[1],
        &validators[2],
    };

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    try cache.append(testing.io, pubkeys[0], 0);

    try testing.expectError(
        error.DuplicatePubkey,
        cache.syncPubkeys(testing.io, &validator_ptrs),
    );
    try testing.expectEqual(@as(u32, 1), cache.count(testing.io));
    try testing.expectEqual(@as(?u64, null), cache.get(testing.io, pubkeys[1]));
}

test "syncPubkeys rejects an invalid key without publishing across batches" {
    const batch_size = cache_module.uncompress_batch_size;
    var pubkeys: [2]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var validators = [_]Validator{
        std.mem.zeroes(Validator),
        std.mem.zeroes(Validator),
        std.mem.zeroes(Validator),
    };
    validators[0].pubkey = pubkeys[0];
    validators[1].pubkey = pubkeys[1];
    validators[2].pubkey = std.mem.zeroes([48]u8);
    var validator_ptrs: [batch_size + 2]*const Validator = undefined;
    validator_ptrs[0] = &validators[0];
    @memset(validator_ptrs[1 .. batch_size + 1], &validators[1]);
    validator_ptrs[batch_size + 1] = &validators[2];

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    try cache.append(testing.io, pubkeys[0], 0);

    try testing.expectError(error.BadEncoding, cache.syncPubkeys(testing.io, &validator_ptrs));
    try testing.expectEqual(@as(u32, 1), cache.count(testing.io));
    try testing.expectEqual(@as(?u64, null), cache.get(testing.io, pubkeys[1]));
}

test "append and clear preserve dense storage invariants" {
    var pubkeys: [4]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();

    for (pubkeys[0..3], 0..) |pubkey, index| {
        try cache.append(testing.io, pubkey, index);
    }
    try cache.append(testing.io, pubkeys[0], 0);

    for (pubkeys[0..3], 0..) |pubkey, expected_index| {
        try testing.expectEqual(
            @as(u64, @intCast(expected_index)),
            cache.get(testing.io, pubkey).?,
        );
        const compressed = cache.getPubkey(testing.io, expected_index).?.compress();
        try testing.expectEqualSlices(u8, &pubkey, &compressed);
    }
    try testing.expectError(
        error.InvalidIndexToAppend,
        cache.append(testing.io, pubkeys[3], pubkeys.len),
    );
    try testing.expectError(
        error.DuplicatePubkey,
        cache.append(testing.io, pubkeys[0], 3),
    );
    try testing.expectError(
        error.ConflictingPubkey,
        cache.append(testing.io, pubkeys[1], 0),
    );
    try testing.expectEqual(@as(u32, 3), cache.count(testing.io));
    try testing.expect(cache.capacity(testing.io) > cache.count(testing.io));

    const capacity = cache.capacity(testing.io);
    try cache.clear(testing.io);
    try testing.expectEqual(@as(u32, 0), cache.count(testing.io));
    try testing.expectEqual(capacity, cache.capacity(testing.io));
    try cache.append(testing.io, pubkeys[3], 0);
    try testing.expectEqual(@as(u64, 0), cache.get(testing.io, pubkeys[3]).?);
}

test "explicit capacity is exact, non-shrinking, and guarded" {
    const unsupported = cache_module.max_capacity + 1;
    try testing.expectError(
        error.CapacityOverflow,
        PubkeyCache.initCapacity(testing.allocator, testing.io, unsupported),
    );

    var cache = try PubkeyCache.initCapacity(testing.allocator, testing.io, 8);
    defer cache.deinit();
    try testing.expectEqual(@as(usize, 8), cache.capacity(testing.io));

    try cache.ensureTotalCapacity(testing.io, 9);
    try testing.expectEqual(@as(usize, 9), cache.capacity(testing.io));
    try cache.ensureTotalCapacity(testing.io, 8);
    try testing.expectEqual(@as(usize, 9), cache.capacity(testing.io));

    try testing.expectError(
        error.CapacityOverflow,
        cache.ensureTotalCapacity(testing.io, unsupported),
    );
}

test "aggregate supports u64 and u32 indices and rejects invalid input" {
    var pubkeys: [2]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    for (pubkeys, 0..) |pubkey, index| {
        try cache.append(testing.io, pubkey, index);
    }

    const aggregate_u64 = try cache.aggregate(testing.io, &.{ 0, 1 });
    const aggregate_u32 = try cache.aggregateIndices(testing.io, u32, &.{ 0, 1 });
    const compressed_u64 = aggregate_u64.compress();
    const compressed_u32 = aggregate_u32.compress();
    try testing.expectEqualSlices(u8, &compressed_u64, &compressed_u32);

    try testing.expectError(error.InvalidLength, cache.aggregate(testing.io, &.{}));
    try testing.expectError(error.InvalidLength, cache.aggregateIndices(testing.io, u32, &.{}));
    try testing.expectError(error.InvalidIndex, cache.aggregate(testing.io, &.{2}));
    try testing.expectError(error.InvalidIndex, cache.aggregateIndices(testing.io, u32, &.{2}));
}

test "batch lookups preserve order and validate inputs" {
    var pubkeys: [5]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);

    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    for (pubkeys[0..4], 0..) |pubkey, index| {
        try cache.append(testing.io, pubkey, index);
    }

    const requested_indices = [_]u64{ 3, 0, 3 };
    var affine_pubkeys: [requested_indices.len]bls.PublicKey = undefined;
    try cache.getPubkeys(testing.io, &requested_indices, &affine_pubkeys);
    for (affine_pubkeys, requested_indices) |affine, index| {
        const compressed = affine.compress();
        try testing.expectEqualSlices(u8, &pubkeys[index], &compressed);
    }
    try testing.expectError(
        error.InvalidLength,
        cache.getPubkeys(testing.io, &requested_indices, affine_pubkeys[0..2]),
    );

    const sentinel = cache.getPubkey(testing.io, 1).?;
    for (&affine_pubkeys) |*affine| affine.* = sentinel;
    try testing.expectError(
        error.InvalidIndex,
        cache.getPubkeys(testing.io, &.{ 0, 4, 1 }, &affine_pubkeys),
    );
    for (affine_pubkeys) |affine| {
        const compressed = affine.compress();
        try testing.expectEqualSlices(u8, &pubkeys[1], &compressed);
    }

    const requested_pubkeys = [_][48]u8{ pubkeys[3], pubkeys[0], pubkeys[3] };
    var validator_indices: [requested_pubkeys.len]u64 = undefined;
    try cache.getValidatorIndices(testing.io, &requested_pubkeys, &validator_indices);
    try testing.expectEqualSlices(u64, &.{ 3, 0, 3 }, &validator_indices);
    try testing.expectError(
        error.InvalidLength,
        cache.getValidatorIndices(
            testing.io,
            &requested_pubkeys,
            validator_indices[0..2],
        ),
    );
    try testing.expectError(
        error.PubkeyNotFound,
        cache.getValidatorIndices(
            testing.io,
            &.{ pubkeys[0], pubkeys[4], pubkeys[1] },
            &validator_indices,
        ),
    );
}
