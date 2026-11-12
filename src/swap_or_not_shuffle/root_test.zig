//! Vector provenance:
//!  - shuffle round-trip and the 100-index spec vector: the upstream repo's
//!    unit tests (test/unit/shuffle.test.ts)
//!  - ComputeShuffledIndex, proposer and sync-committee vectors: carried over
//!    from this repo's src/state_transition/utils/committee_indices.zig tests
//!  - out-of-range wrapping vector: captured from @chainsafe/swap-or-not-shuffle
//!    v1.2.1 (see the test)
//!  - validation-order and error-path cases: written for this port; the
//!    reference crashes on those inputs, so it has no equivalent

const std = @import("std");
const shuffle = @import("./root.zig");

const SEED_SIZE = shuffle.SEED_SIZE;

test "innerShuffleList roundtrip matches reference vector" {
    var input = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7, 8 };
    const seed = [_]u8{0} ** SEED_SIZE;
    const rounds = 32;

    try shuffle.unshuffleList(u32, input[0..], seed[0..], rounds);
    // checked against @chainsafe/swap-or-not-shuffle
    const expected = [_]u32{ 6, 2, 3, 5, 1, 7, 8, 0, 4 };
    try std.testing.expectEqualSlices(u32, expected[0..], input[0..]);

    try shuffle.shuffleList(u32, input[0..], seed[0..], rounds);
    const expected_input = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7, 8 };
    try std.testing.expectEqualSlices(u32, expected_input[0..], input[0..]);
}

test "innerShuffleList generic over u64" {
    var input: [100]u64 = undefined;
    for (0..input.len) |i| input[i] = if (i % 2 == 0) std.math.maxInt(u64) - i else i;
    var actual = input;
    var seed: [SEED_SIZE]u8 = undefined;
    for (0..SEED_SIZE) |i| seed[i] = @intCast(i * 7 % 256);

    var reference = try shuffle.ComputeShuffledIndex.init(std.testing.allocator, &seed, input.len, 90);
    defer reference.deinit();

    try shuffle.shuffleList(u64, &actual, &seed, 90);
    for (input, 0..) |value, i| {
        try std.testing.expectEqual(value, actual[try reference.get(@intCast(i))]);
    }
    try shuffle.unshuffleList(u64, &actual, &seed, 90);
    try std.testing.expectEqualSlices(u64, &input, &actual);
}

test "list shuffle matches ComputeShuffledIndex across pair and source hash boundaries" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{0x5a} ** SEED_SIZE;
    const rounds = shuffle.SHUFFLE_ROUNDS_MAINNET;
    const list_sizes =
        // Sizes below 16 only swap one pair at a time; longer lists also take eight-pair steps.
        [_]u32{
            2,  3,  4,  5,  6,  7,  8,  9,  10, 11, 12, 13, 14, 15, 16,
            17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
            32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
            47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61,
            62, 63, 64,
        } ++
        // One source hash decides 256 positions.
        [_]u32{ 255, 256, 257, 511, 512, 513, 1023, 1024, 1025 };

    for (list_sizes) |list_size| {
        var reference = try shuffle.ComputeShuffledIndex.init(allocator, &seed, list_size, rounds);
        defer reference.deinit();

        const positions = try allocator.alloc(u32, list_size);
        defer allocator.free(positions);

        for (positions, 0..) |*position, i| position.* = @intCast(i);
        try shuffle.unshuffleList(u32, positions, &seed, rounds);
        for (positions, 0..) |position, i| {
            try std.testing.expectEqual(try reference.get(@intCast(i)), position);
        }

        try shuffle.shuffleList(u32, positions, &seed, rounds);
        for (positions, 0..) |position, i| {
            try std.testing.expectEqual(@as(u32, @intCast(i)), position);
        }
    }
}

test "unshuffleList matches spec test vector" {
    // seed 0x4fe91d85d6bc19b20413659c61f3c690a1c4d48be41cab8363a130cebabada97
    const seed = [_]u8{
        0x4f, 0xe9, 0x1d, 0x85, 0xd6, 0xbc, 0x19, 0xb2, 0x04, 0x13, 0x65, 0x9c, 0x61, 0xf3, 0xc6, 0x90,
        0xa1, 0xc4, 0xd4, 0x8b, 0xe4, 0x1c, 0xab, 0x83, 0x63, 0xa1, 0x30, 0xce, 0xba, 0xba, 0xda, 0x97,
    };
    const rounds = 10;

    var input: [100]u32 = undefined;
    for (0..input.len) |i| input[i] = @intCast(i);

    try shuffle.unshuffleList(u32, input[0..], seed[0..], rounds);

    const expected = [_]u32{
        99, 71, 51, 5,  78, 61, 12, 17, 30, 3,  59, 47, 6,  9,  1,  41, 18, 37, 55, 43, 20, 31, 38, 79, 29,
        69, 70, 54, 53, 36, 34, 62, 77, 87, 39, 96, 56, 92, 16, 82, 40, 27, 58, 14, 68, 76, 80, 13, 28, 81,
        64, 26, 19, 60, 90, 2,  98, 67, 66, 52, 46, 95, 49, 72, 8,  21, 75, 57, 97, 83, 84, 88, 86, 7,  74,
        32, 63, 85, 23, 65, 24, 91, 0,  48, 35, 15, 44, 25, 22, 73, 93, 45, 4,  33, 89, 94, 10, 42, 11, 50,
    };
    try std.testing.expectEqualSlices(u32, expected[0..], input[0..]);
}

test "innerShuffleList no-op conditions match reference validation order" {
    const good_seed = [_]u8{0} ** SEED_SIZE;
    const bad_seed = [_]u8{0xac} ** 31;

    // rounds == 0 returns before any validation
    var list = [_]u32{ 0, 1, 2, 3, 4 };
    try shuffle.innerShuffleList(u32, list[0..], bad_seed[0..], 0, false);
    try std.testing.expectEqualSlices(u32, &[_]u32{ 0, 1, 2, 3, 4 }, list[0..]);

    // list length <= 1 returns before seed/rounds validation
    var single = [_]u32{7};
    try shuffle.innerShuffleList(u32, single[0..], bad_seed[0..], -1, false);
    try std.testing.expectEqual(@as(u32, 7), single[0]);
    var empty = [_]u32{};
    try shuffle.innerShuffleList(u32, empty[0..], bad_seed[0..], 300, true);

    // invalid seed is checked before invalid rounds
    var multi = [_]u32{ 0, 1, 2 };
    try std.testing.expectError(error.InvalidSeedLength, shuffle.innerShuffleList(u32, multi[0..], bad_seed[0..], -1, false));

    const long_seed = [_]u8{0xac} ** 33;
    try std.testing.expectError(error.InvalidSeedLength, shuffle.innerShuffleList(u32, multi[0..], long_seed[0..], 10, false));

    try std.testing.expectError(error.InvalidNumberOfRounds, shuffle.innerShuffleList(u32, multi[0..], good_seed[0..], -1, false));
    try std.testing.expectError(error.InvalidNumberOfRounds, shuffle.innerShuffleList(u32, multi[0..], good_seed[0..], 256, false));
}

test "ComputeShuffledIndex matches reference vector" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** SEED_SIZE;
    const index_count = 1000;
    const rounds = 90;

    var instance = try shuffle.ComputeShuffledIndex.init(allocator, seed[0..], index_count, rounds);
    defer instance.deinit();

    const expected = [_]u32{
        789, 161, 541, 509, 498, 445, 270, 2,   505, 621, 947, 550, 338, 814, 285, 597,
        169, 819, 644, 638, 751, 514, 750, 523, 303, 231, 391, 982, 409, 396, 641, 837,
    };
    for (expected, 0..) |want, i| {
        try std.testing.expectEqual(want, try instance.get(@intCast(i)));
    }
}

test "ComputeShuffledIndex rejects invalid seed" {
    const bad_seed = [_]u8{1} ** 31;
    try std.testing.expectError(
        error.InvalidSeedLength,
        shuffle.ComputeShuffledIndex.init(std.testing.allocator, bad_seed[0..], 1000, 90),
    );
}

test "ComputeShuffledIndex.get wraps like the reference for out-of-range indices" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** SEED_SIZE;
    const index_count = 10;
    const rounds = 90;

    var instance = try shuffle.ComputeShuffledIndex.init(allocator, seed[0..], index_count, rounds);
    defer instance.deinit();

    // checked against @chainsafe/swap-or-not-shuffle:
    // node -e "const r = require('@chainsafe/swap-or-not-shuffle');
    //   const c = new r.ComputeShuffledIndex(new Uint8Array(32).fill(1), 10, 90);
    //   console.log(c.get(100))"
    const result = try instance.get(100);
    try std.testing.expectEqual(@as(u32, 1), result);
}

const MAX_EFFECTIVE_BALANCE: i64 = 32_000_000_000;
const MAX_EFFECTIVE_BALANCE_ELECTRA: i64 = 2_048_000_000_000;
const EFFECTIVE_BALANCE_INCREMENT: i64 = 1_000_000_000;

fn testBalances(comptime vc: usize) struct { indices: [vc]u32, increments: [vc]u16 } {
    var indices: [vc]u32 = undefined;
    var increments: [vc]u16 = undefined;
    for (0..vc) |i| {
        indices[i] = @intCast(i);
        increments[i] = @intCast(32 + 32 * (i % 64));
    }
    return .{ .indices = indices, .increments = increments };
}

test "computeProposerIndex matches reference vectors" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** SEED_SIZE;
    const data = testBalances(1000);
    const rounds = 90;

    const phase0_index = try shuffle.computeProposerIndex(
        allocator,
        seed[0..],
        data.indices[0..],
        data.increments[0..],
        .one,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
    );
    try std.testing.expectEqual(@as(u32, 789), phase0_index);

    const electra_index = try shuffle.computeProposerIndexElectra(
        allocator,
        seed[0..],
        data.indices[0..],
        data.increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
    );
    try std.testing.expectEqual(@as(u32, 161), electra_index);
}

test "computeSyncCommitteeIndices matches reference vectors" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{
        74,  7,   102, 54,  84, 136, 68, 56,  19,  191, 186, 58,  72,  53, 151, 49,
        220, 123, 42,  116, 59, 7,   73, 162, 110, 145, 93,  199, 163, 66, 85,  34,
    };
    const data = testBalances(1000);
    const rounds = 90;

    var phase0: [32]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        seed[0..],
        data.indices[0..],
        data.increments[0..],
        .one,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
        &phase0,
    );

    const expected_phase0 = [_]u32{
        293, 726, 771, 677, 530, 475, 322, 66,  521, 106, 774, 23,  508, 410, 526, 44,
        213, 948, 248, 903, 85,  853, 171, 679, 309, 791, 851, 817, 609, 119, 128, 983,
    };
    try std.testing.expectEqualSlices(u32, expected_phase0[0..], &phase0);

    var electra: [32]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        seed[0..],
        data.indices[0..],
        data.increments[0..],
        .two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
        &electra,
    );

    const expected_electra = [_]u32{
        726, 475, 521, 23,  508, 410, 213, 948, 248, 85,  171, 309, 791, 817, 119, 126,
        651, 416, 273, 471, 739, 290, 588, 840, 665, 945, 496, 158, 757, 616, 226, 766,
    };
    try std.testing.expectEqualSlices(u32, expected_electra[0..], &electra);
}

fn expectSyncCommitteeMatchesGetCommitteeIndices(
    seed: []const u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    rounds: u32,
) !void {
    const allocator = std.testing.allocator;
    const committee_size = 32;

    var expected: [committee_size]u32 = undefined;
    try shuffle.getCommitteeIndices(
        allocator,
        seed,
        active_indices,
        effective_balance_increments,
        .two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
        &expected,
    );

    var actual: [committee_size]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        seed,
        active_indices,
        effective_balance_increments,
        .two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
        &actual,
    );

    try std.testing.expectEqualSlices(u32, &expected, &actual);
}

/// The random value the samplers draw for their first candidate.
fn firstRandomValue(seed: *const [SEED_SIZE]u8) u16 {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(&(seed.* ++ [_]u8{0} ** 8), &hash, .{});
    return std.mem.readInt(u16, hash[0..2], .little);
}

test "computeSyncCommitteeIndicesInto matches getCommitteeIndices on low-balance sets" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{0xc3} ** SEED_SIZE;

    // Cover candidate wraparound and 256-position shuffle-hash boundaries.
    for ([_]usize{ 1, 2, 17, 255, 256, 257, 1000, 4097 }) |active_count| {
        const active_indices = try allocator.alloc(u32, active_count);
        defer allocator.free(active_indices);

        const effective_balance_increments = try allocator.alloc(u16, 2 * active_count);
        defer allocator.free(effective_balance_increments);

        // Validator indices differ from list positions, as they do once validators have exited.
        for (active_indices, 0..) |*index, i| index.* = @intCast(2 * i + 1);
        for (effective_balance_increments, 0..) |*increment, i| {
            increment.* = @intCast(32 + 32 * (i % 7));
        }

        // 0 and 256 rounds stay with `getCommitteeIndices`, so they exercise the fallback.
        for ([_]u32{ 0, 1, 10, 90, 255, 256 }) |rounds| {
            try expectSyncCommitteeMatchesGetCommitteeIndices(
                &seed,
                active_indices,
                effective_balance_increments,
                rounds,
            );
        }
    }
}

test "computeSyncCommitteeIndicesInto accepts a full balance on the largest random value" {
    var seed = [_]u8{0} ** SEED_SIZE;
    std.mem.writeInt(u64, seed[0..8], 14867, .little);
    try std.testing.expectEqual(65535, firstRandomValue(&seed));

    // 2048 * 65535 >= 2048 * 65535 holds with equality, so the first candidate is accepted.
    const active_indices = [_]u32{ 0, 1, 2, 3 };
    const effective_balance_increments = [_]u16{2048} ** 4;
    try expectSyncCommitteeMatchesGetCommitteeIndices(
        &seed,
        &active_indices,
        &effective_balance_increments,
        90,
    );
}

test "computeSyncCommitteeIndicesInto rejects a 32 ETH validator on random value 1024" {
    var seed = [_]u8{0} ** SEED_SIZE;
    std.mem.writeInt(u64, seed[0..8], 46894, .little);
    try std.testing.expectEqual(1024, firstRandomValue(&seed));

    // 32 * 65535 is 32 short of 2048 * 1024, so the first candidate is rejected.
    const active_indices = [_]u32{ 0, 1, 2, 3 };
    const effective_balance_increments = [_]u16{32} ** 4;
    try expectSyncCommitteeMatchesGetCommitteeIndices(
        &seed,
        &active_indices,
        &effective_balance_increments,
        90,
    );
}

test "computeSyncCommitteeIndicesInto reports the same input errors as getCommitteeIndices" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** SEED_SIZE;
    const short_seed = [_]u8{1} ** 31;
    const one_index = [_]u32{0};
    const one_increment = [_]u16{32};
    var out: [32]u32 = undefined;

    // A one-entry list is never shuffled, so the seed length has to be checked separately.
    try std.testing.expectError(error.InvalidSeedLength, shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        &short_seed,
        &one_index,
        &one_increment,
        .two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &out,
    ));

    const out_of_bounds_index = [_]u32{5};
    try std.testing.expectError(
        error.EffectiveBalanceIncrementsOutOfBounds,
        shuffle.computeSyncCommitteeIndicesInto(
            allocator,
            &seed,
            &out_of_bounds_index,
            &one_increment,
            .two,
            MAX_EFFECTIVE_BALANCE_ELECTRA,
            EFFECTIVE_BALANCE_INCREMENT,
            90,
            &out,
        ),
    );

    try std.testing.expectError(
        error.EmptyActiveIndices,
        shuffle.computeSyncCommitteeIndicesInto(
            allocator,
            &seed,
            &[_]u32{},
            &one_increment,
            .two,
            MAX_EFFECTIVE_BALANCE_ELECTRA,
            EFFECTIVE_BALANCE_INCREMENT,
            90,
            &out,
        ),
    );

    try std.testing.expectError(
        error.InvalidEffectiveBalanceIncrement,
        shuffle.computeSyncCommitteeIndicesInto(
            allocator,
            &seed,
            &one_index,
            &one_increment,
            .two,
            MAX_EFFECTIVE_BALANCE_ELECTRA,
            0,
            90,
            &out,
        ),
    );
}

test "computeSyncCommitteeIndices with one random byte matches getCommitteeIndices" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{0x5a} ** SEED_SIZE;
    const active_indices = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7 };
    // Below the 32 increment maximum, so one and two random bytes select different committees.
    const effective_balance_increments = [_]u16{ 16, 18, 20, 22, 24, 26, 28, 30 };

    var expected: [32]u32 = undefined;
    try shuffle.getCommitteeIndices(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .one,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &expected,
    );

    var actual: [32]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .one,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &actual,
    );

    try std.testing.expectEqualSlices(u32, &expected, &actual);
}

test "computeSyncCommitteeIndicesInto wraps like getCommitteeIndices on an oversized balance" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{0x5a} ** SEED_SIZE;
    const active_indices = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7 };
    const effective_balance_increments = [_]u16{ 16, 18, 20, 22, 24, 26, 28, 30 };
    // The maximum increment count times a random value overflows an i64.
    const max_effective_balance = std.math.maxInt(i64);
    const effective_balance_increment = 1;

    var expected: [32]u32 = undefined;
    try shuffle.getCommitteeIndices(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .two,
        max_effective_balance,
        effective_balance_increment,
        90,
        &expected,
    );

    var actual: [32]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .two,
        max_effective_balance,
        effective_balance_increment,
        90,
        &actual,
    );

    try std.testing.expectEqualSlices(u32, &expected, &actual);
}

test "computeSyncCommitteeIndicesInto matches getCommitteeIndices on a negative maximum balance" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{0x5a} ** SEED_SIZE;
    const active_indices = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7 };
    const effective_balance_increments = [_]u16{ 16, 18, 20, 22, 24, 26, 28, 30 };
    const max_effective_balance = -EFFECTIVE_BALANCE_INCREMENT;

    var expected: [32]u32 = undefined;
    try shuffle.getCommitteeIndices(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .two,
        max_effective_balance,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &expected,
    );

    var actual: [32]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .two,
        max_effective_balance,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &actual,
    );

    try std.testing.expectEqualSlices(u32, &expected, &actual);
}

fn sampleLowBalanceSyncCommittee(allocator: std.mem.Allocator) !void {
    const seed = [_]u8{0x5a} ** SEED_SIZE;
    const active_indices = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7 };
    const effective_balance_increments = [_]u16{32} ** 8;

    var committee: [32]u32 = undefined;
    try shuffle.computeSyncCommitteeIndicesInto(
        allocator,
        &seed,
        &active_indices,
        &effective_balance_increments,
        .two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &committee,
    );
}

test "memory_safety: computeSyncCommitteeIndicesInto frees everything when an allocation fails" {
    try std.testing.checkAllAllocationFailures(
        std.testing.allocator,
        sampleLowBalanceSyncCommittee,
        .{},
    );
}

test "computeSyncCommitteeIndicesInto uses only shuffle scratch for low and high balances" {
    const seed = [_]u8{0x5a} ** SEED_SIZE;
    var active_indices: [4097]u32 = undefined;
    for (&active_indices, 0..) |*index, i| index.* = @intCast(i);

    for ([_]u16{ 32, 2048 }) |balance| {
        const effective_balance_increments = [_]u16{balance} ** active_indices.len;
        var out: [32]u32 = undefined;
        var expected: [out.len]u32 = undefined;
        try shuffle.getCommitteeIndices(
            std.testing.allocator,
            &seed,
            &active_indices,
            &effective_balance_increments,
            .two,
            MAX_EFFECTIVE_BALANCE_ELECTRA,
            EFFECTIVE_BALANCE_INCREMENT,
            90,
            &expected,
        );

        var counting = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        try shuffle.computeSyncCommitteeIndicesInto(
            counting.allocator(),
            &seed,
            &active_indices,
            &effective_balance_increments,
            .two,
            MAX_EFFECTIVE_BALANCE_ELECTRA,
            EFFECTIVE_BALANCE_INCREMENT,
            90,
            &out,
        );
        try std.testing.expectEqualSlices(u32, &expected, &out);
        try std.testing.expect(counting.allocations <= 1);
    }
}

test "getCommitteeIndices rejects empty active indices" {
    const allocator = std.testing.allocator;
    var out: [1]u32 = undefined;
    const seed = [_]u8{1} ** SEED_SIZE;
    const active_indices = [_]u32{};
    const increments = [_]u16{};

    try std.testing.expectError(error.EmptyActiveIndices, shuffle.getCommitteeIndices(
        allocator,
        seed[0..],
        active_indices[0..],
        increments[0..],
        .one,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &out,
    ));
}

test "getCommitteeIndices rejects zero effective balance increment" {
    const allocator = std.testing.allocator;
    var out: [1]u32 = undefined;
    const seed = [_]u8{1} ** SEED_SIZE;
    const active_indices = [_]u32{0};
    const increments = [_]u16{32};

    try std.testing.expectError(error.InvalidEffectiveBalanceIncrement, shuffle.getCommitteeIndices(
        allocator,
        seed[0..],
        active_indices[0..],
        increments[0..],
        .one,
        MAX_EFFECTIVE_BALANCE,
        0,
        90,
        &out,
    ));
}

test "getCommitteeIndices rejects out-of-bounds candidate index" {
    const allocator = std.testing.allocator;
    var out: [1]u32 = undefined;
    const seed = [_]u8{1} ** SEED_SIZE;
    // a single active index >= effective_balance_increments.len (1) triggers
    // the out-of-bounds lookup on the very first candidate.
    const active_indices = [_]u32{5};
    const increments = [_]u16{32};

    try std.testing.expectError(error.EffectiveBalanceIncrementsOutOfBounds, shuffle.getCommitteeIndices(
        allocator,
        seed[0..],
        active_indices[0..],
        increments[0..],
        .one,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        90,
        &out,
    ));
}

test "computePtcIndices matches naive reference vector" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** SEED_SIZE;
    const data = testBalances(100);

    const result = try allocator.alloc(u32, 32);
    defer allocator.free(result);
    try shuffle.computePtcIndicesInto(
        seed[0..],
        data.indices[0..],
        data.increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        result,
    );

    // generated with the naive lodestar PTC sampler ported in
    // https://github.com/ChainSafe/swap-or-not-shuffle/pull/24
    const expected = [_]u32{
        4,  8,  9,  15, 20, 22, 30, 31, 32, 35, 38, 41, 42, 44, 45, 46,
        49, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 78, 81, 83, 84,
    };
    try std.testing.expectEqualSlices(u32, expected[0..], result);
}

test "computePtcIndicesForEpoch matches naive reference vector" {
    const allocator = std.testing.allocator;
    const epoch_seed = [_]u8{2} ** SEED_SIZE;
    const data = testBalances(80);
    const slot_offsets = [_]u32{ 0, 20, 40, 60, 80 };

    const result = try allocator.alloc(u32, 4 * 8);
    defer allocator.free(result);
    try shuffle.computePtcIndicesForEpochInto(
        epoch_seed[0..],
        5,
        4,
        data.indices[0..],
        slot_offsets[0..],
        data.increments[0..],
        8,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        result,
    );

    const expected = [_]u32{
        8,  9,  10, 15, 16, 14, 16, 4,  21, 26, 27, 28, 29, 30, 31, 35,
        40, 42, 44, 45, 46, 47, 48, 49, 60, 62, 63, 68, 76, 60, 62, 63,
    };
    try std.testing.expectEqualSlices(u32, expected[0..], result);
}

test "computePtcIndicesForEpoch slots agree with computePtcIndices" {
    const allocator = std.testing.allocator;
    const epoch_seed = [_]u8{2} ** SEED_SIZE;
    const data = testBalances(80);
    const slot_offsets = [_]u32{ 0, 20, 40, 60, 80 };
    const start_slot = 5;
    const ptc_size = 8;

    const epoch_result = try allocator.alloc(u32, 4 * ptc_size);
    defer allocator.free(epoch_result);
    try shuffle.computePtcIndicesForEpochInto(
        epoch_seed[0..],
        start_slot,
        4,
        data.indices[0..],
        slot_offsets[0..],
        data.increments[0..],
        ptc_size,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        epoch_result,
    );

    const Sha256 = std.crypto.hash.sha2.Sha256;
    for (0..4) |slot| {
        var input = [_]u8{0} ** (SEED_SIZE + 8);
        @memcpy(input[0..SEED_SIZE], epoch_seed[0..]);
        std.mem.writeInt(u64, input[SEED_SIZE..][0..8], start_slot + slot, .little);
        var slot_seed: [SEED_SIZE]u8 = undefined;
        Sha256.hash(&input, &slot_seed, .{});

        const slot_result = try allocator.alloc(u32, ptc_size);
        defer allocator.free(slot_result);
        try shuffle.computePtcIndicesInto(
            slot_seed[0..],
            data.indices[slot_offsets[slot]..slot_offsets[slot + 1]],
            data.increments[0..],
            MAX_EFFECTIVE_BALANCE_ELECTRA,
            EFFECTIVE_BALANCE_INCREMENT,
            slot_result,
        );
        try std.testing.expectEqualSlices(u32, slot_result, epoch_result[slot * ptc_size ..][0..ptc_size]);
    }
}

test "computePtcIndicesInto rejects invalid inputs gracefully" {
    const good_seed = [_]u8{1} ** SEED_SIZE;
    const bad_seed = [_]u8{1} ** 31;
    const data = testBalances(10);
    var out: [8]u32 = undefined;

    try std.testing.expectError(error.InvalidSeedLength, shuffle.computePtcIndicesInto(
        bad_seed[0..],
        data.indices[0..],
        data.increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0..],
    ));

    try std.testing.expectError(error.EmptyActiveIndices, shuffle.computePtcIndicesInto(
        good_seed[0..],
        &[_]u32{},
        data.increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0..],
    ));

    try std.testing.expectError(error.InvalidEffectiveBalanceIncrement, shuffle.computePtcIndicesInto(
        good_seed[0..],
        data.indices[0..],
        data.increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        0,
        out[0..],
    ));

    // candidate index beyond the increments slice
    const oob_indices = [_]u32{99};
    const short_increments = [_]u16{32};
    try std.testing.expectError(error.EffectiveBalanceIncrementsOutOfBounds, shuffle.computePtcIndicesInto(
        good_seed[0..],
        oob_indices[0..],
        short_increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0..],
    ));

    // an empty `out` is a no-op where the reference would loop forever
    try shuffle.computePtcIndicesInto(
        good_seed[0..],
        data.indices[0..],
        data.increments[0..],
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0..0],
    );
}

test "computePtcIndicesForEpochInto rejects invalid inputs gracefully" {
    const epoch_seed = [_]u8{2} ** SEED_SIZE;
    const data = testBalances(80);
    var out: [4 * 8]u32 = undefined;

    // too few offsets for the slot count
    const short_offsets = [_]u32{ 0, 20 };
    try std.testing.expectError(error.InvalidSlotOffsets, shuffle.computePtcIndicesForEpochInto(
        epoch_seed[0..],
        0,
        4,
        data.indices[0..],
        short_offsets[0..],
        data.increments[0..],
        8,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0..],
    ));

    // offsets beyond the shuffling length
    const oob_offsets = [_]u32{ 0, 20, 40, 60, 999 };
    try std.testing.expectError(error.InvalidSlotOffsets, shuffle.computePtcIndicesForEpochInto(
        epoch_seed[0..],
        0,
        4,
        data.indices[0..],
        oob_offsets[0..],
        data.increments[0..],
        8,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0..],
    ));

    // out length must match slots_per_epoch * ptc_size
    const good_offsets = [_]u32{ 0, 20, 40, 60, 80 };
    try std.testing.expectError(error.InvalidOutputLength, shuffle.computePtcIndicesForEpochInto(
        epoch_seed[0..],
        0,
        4,
        data.indices[0..],
        good_offsets[0..],
        data.increments[0..],
        8,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        out[0 .. out.len - 1],
    ));
}
