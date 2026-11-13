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

    try cache.syncPubkeys(testing.allocator, testing.io, validator_ptrs[0..initial_count]);
    try cache.syncPubkeys(testing.allocator, testing.io, &validator_ptrs);

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
    try cache.syncPubkeys(testing.allocator, testing.io, &validator_ptrs);

    try cache.syncPubkeys(testing.allocator, testing.io, validator_ptrs[0..2]);

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
        cache.syncPubkeys(testing.allocator, testing.io, &validator_ptrs),
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

    try testing.expectError(error.BadEncoding, cache.syncPubkeys(testing.allocator, testing.io, &validator_ptrs));
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
}

test "candidates are deduplicated without decoding and pruned by finalized index" {
    var pubkeys: [3]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();

    try cache.addCandidate(testing.io, pubkeys[1], 0);
    try cache.addCandidate(testing.io, pubkeys[1], 2);
    try cache.addCandidate(testing.io, pubkeys[1], 0);
    try cache.addCandidate(testing.io, pubkeys[1], 2);
    try cache.addCandidate(testing.io, pubkeys[2], 1);
    try cache.addCandidate(testing.io, @splat(0), 9);
    {
        const indices = try cache.getCandidates(testing.allocator, testing.io, pubkeys[1]);
        defer testing.allocator.free(indices);
        try testing.expectEqualSlices(u32, &.{ 0, 2 }, indices);
    }
    try testing.expectEqual(@as(u32, 0), cache.count(testing.io));
    try testing.expectEqual(@as(?u64, null), cache.get(testing.io, pubkeys[1]));

    try cache.append(testing.io, pubkeys[0], 0);
    try cache.append(testing.io, pubkeys[2], 1);
    try cache.pruneCandidates(testing.io);
    {
        const retained = try cache.getCandidates(testing.allocator, testing.io, pubkeys[1]);
        defer testing.allocator.free(retained);
        try testing.expectEqualSlices(u32, &.{2}, retained);
        const pruned = try cache.getCandidates(testing.allocator, testing.io, pubkeys[2]);
        defer testing.allocator.free(pruned);
        try testing.expectEqual(@as(usize, 0), pruned.len);
    }
    try cache.addCandidate(testing.io, pubkeys[2], 1);
    try testing.expectEqual(@as(usize, 2), cache.candidates.count());
    try cache.clear(testing.io);
    try testing.expectEqual(@as(usize, 0), cache.candidates.count());
    try testing.expectError(error.CapacityOverflow, cache.addCandidate(testing.io, pubkeys[0], cache_module.max_capacity));
}

test "state-aware candidates resolve conflicting branches and bound historical dense lookups" {
    const Node = @import("persistent_merkle_tree").Node;
    const Validators = types.phase0.Validators;
    var pool = try Node.Pool.init(.{ .page_allocator = testing.allocator, .allocator = testing.allocator, .pool_size = 4096 });
    defer pool.deinit();
    var pubkeys: [3]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    var canonical = try Validators.TreeView.fromValue(testing.allocator, &pool, &Validators.default_value);
    defer canonical.deinit();
    var side = try Validators.TreeView.fromValue(testing.allocator, &pool, &Validators.default_value);
    defer side.deinit();
    for (pubkeys, 0..) |pubkey, index| {
        var validator = types.phase0.Validator.default_value;
        validator.pubkey = pubkey;
        try side.pushValue(&validator);
        if (index != 1) try canonical.pushValue(&validator);
    }
    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    try cache.append(testing.io, pubkeys[0], 0);
    try cache.addCandidate(testing.io, pubkeys[1], 1);
    try cache.addCandidate(testing.io, pubkeys[2], 2);
    try cache.addCandidate(testing.io, pubkeys[2], 1);
    try testing.expectEqual(@as(?u64, 1), try cache.getValidatorIndex(testing.io, side, pubkeys[1]));
    try testing.expectEqual(@as(?u64, 2), try cache.getValidatorIndex(testing.io, side, pubkeys[2]));
    try testing.expectEqual(@as(?u64, null), try cache.getValidatorIndex(testing.io, canonical, pubkeys[1]));
    try testing.expectEqual(@as(?u64, 1), try cache.getValidatorIndex(testing.io, canonical, pubkeys[2]));
    try testing.expectEqual(@as(u32, 1), cache.count(testing.io));
    try cache.append(testing.io, pubkeys[2], 1);
    try cache.pruneCandidates(testing.io);
    try testing.expectEqual(@as(?u64, 1), try cache.getValidatorIndex(testing.io, canonical, pubkeys[2]));
    var historical = try canonical.sliceTo(0);
    defer historical.deinit();
    try testing.expectEqual(@as(?u64, null), try cache.getValidatorIndex(testing.io, historical, pubkeys[2]));
}

test "truncate removes both dense lookup directions and permits a different suffix" {
    var pubkeys: [3]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    for (pubkeys, 0..) |pubkey, index| try cache.append(testing.io, pubkey, index);
    const capacity = cache.capacity(testing.io);
    try cache.truncate(testing.io, 1);
    try testing.expectEqual(@as(u32, 1), cache.count(testing.io));
    try testing.expectEqual(capacity, cache.capacity(testing.io));
    try testing.expectEqual(@as(?u64, 0), cache.get(testing.io, pubkeys[0]));
    try testing.expectEqual(@as(?u64, null), cache.get(testing.io, pubkeys[1]));
    try testing.expectEqual(@as(?[48]u8, null), cache.getPubkeyBytes(testing.io, 1));
    try cache.append(testing.io, pubkeys[2], 1);
    try testing.expectEqual(@as(?u64, 1), cache.get(testing.io, pubkeys[2]));
    try testing.expectError(error.InvalidIndex, cache.truncate(testing.io, 3));
    try cache.truncate(testing.io, 0);
    try testing.expectEqual(@as(u32, 0), cache.count(testing.io));
}

test "matchesValidators checks the entire retained prefix" {
    var pubkeys: [4]types.primitive.BLSPubkey.Type = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    var cache = PubkeyCache.init(testing.allocator, testing.io);
    defer cache.deinit();
    const validator_size = types.phase0.Validator.fixed_size;
    var bytes: [pubkeys.len * validator_size]u8 = @splat(0);
    for (pubkeys, 0..) |pubkey, index| {
        try cache.append(testing.io, pubkey, index);
        @memcpy(bytes[index * validator_size ..][0..48], &pubkey);
    }
    try testing.expect(try cache.matchesValidators(testing.io, &bytes));
    @memcpy(bytes[validator_size..][0..48], &pubkeys[2]);
    @memcpy(bytes[2 * validator_size ..][0..48], &pubkeys[1]);
    try testing.expect(!try cache.matchesValidators(testing.io, &bytes));
    try testing.expect(try cache.matchesValidators(testing.io, bytes[0..validator_size]));
    try testing.expect(try cache.matchesValidators(testing.io, &.{}));
    try testing.expectError(error.InvalidLength, cache.matchesValidators(testing.io, bytes[0 .. bytes.len - 1]));
    try cache.truncate(testing.io, 1);
    try testing.expect(try cache.matchesValidators(testing.io, &bytes));
}

test "candidate allocation failures release all memory" {
    try testing.checkAllAllocationFailures(testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            var cache = PubkeyCache.init(allocator, testing.io);
            defer cache.deinit();
            try cache.addCandidate(testing.io, @splat(0), 0);
            try cache.addCandidate(testing.io, @splat(0), 1);
            try cache.addCandidate(testing.io, @splat(1), 2);
            const candidates = try cache.getCandidates(allocator, testing.io, @splat(0));
            defer allocator.free(candidates);
            try cache.pruneCandidates(testing.io);
        }
    }.run, .{});
}
