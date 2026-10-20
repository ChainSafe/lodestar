const std = @import("std");
const Sha256 = std.crypto.hash.sha2.Sha256;
const Allocator = std.mem.Allocator;
const swap_or_not_shuffle = @import("swap_or_not_shuffle");

const ACTIVE_INDICES_LENGTH_MAX: usize = std.math.maxInt(u32);
const ComputeShuffledIndex = swap_or_not_shuffle.ComputeShuffledIndex;

pub fn computeProposerIndex(
    allocator: Allocator,
    seed: *const [32]u8,
    active_indices: []const u32,
    effective_balance_increments: []u16,
    rand_byte_count: ByteCount,
    max_effective_balance: u64,
    effective_balance_increment: u32,
    rounds: u32,
) !u64 {
    var out = [_]u64{0};
    try getCommitteeIndices(
        allocator,
        seed,
        active_indices,
        effective_balance_increments,
        rand_byte_count,
        max_effective_balance,
        effective_balance_increment,
        rounds,
        out[0..],
    );
    return out[0];
}

pub fn computeSyncCommitteeIndices(
    allocator: Allocator,
    seed: *const [32]u8,
    active_indices: []const u32,
    effective_balance_increments: []u16,
    rand_byte_count: ByteCount,
    max_effective_balance_electra: u64,
    effective_balance_increment: u32,
    rounds: u32,
    out: []u64,
) !void {
    try getCommitteeIndices(
        allocator,
        seed,
        active_indices,
        effective_balance_increments,
        rand_byte_count,
        max_effective_balance_electra,
        effective_balance_increment,
        rounds,
        out,
    );
}

pub const ByteCount = enum(u8) {
    One = 1,
    Two = 2,
};

/// the same to Rust implementation with "out" param to simplify memory allocation
fn getCommitteeIndices(
    allocator: Allocator,
    seed: *const [32]u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    rand_byte_count: ByteCount,
    max_effective_balance: u64,
    effective_balance_increment: u32,
    rounds: u32,
    out: []u64,
) !void {
    const max_random_value: u32 = switch (rand_byte_count) {
        .One => 0xff,
        .Two => 0xffff,
    };
    const max_effective_balance_increment: u64 = max_effective_balance / effective_balance_increment;

    if (active_indices.len == 0) {
        return error.InvalidIndexCount;
    }
    if (rounds == 0) {
        return error.InvalidRounds;
    }
    if (active_indices.len > ACTIVE_INDICES_LENGTH_MAX) {
        return error.InvalidIndexCount;
    }

    var compute_shuffled_index = try ComputeShuffledIndex.init(
        allocator,
        seed,
        @intCast(active_indices.len),
        rounds,
    );
    defer compute_shuffled_index.deinit();

    var shuffled_result = std.AutoHashMap(u32, u32).init(allocator);
    defer shuffled_result.deinit();

    var i: u32 = 0;
    var cached_hash_input = [_]u8{0} ** (32 + 8);
    // seed should have 32 bytes as checked in ComputeShuffledIndex.init
    @memcpy(cached_hash_input[0..32], seed);
    var cached_hash = [_]u8{0} ** 32;
    var next_committee_index: usize = 0;

    while (next_committee_index < out.len) {
        const index: u32 = @intCast(i % active_indices.len);
        const shuffled_index = try shuffled_result.getOrPut(index);
        if (!shuffled_index.found_existing) {
            const _shuffled_index = try compute_shuffled_index.get(index);
            shuffled_index.value_ptr.* = _shuffled_index;
        }
        const candidate_index = active_indices[shuffled_index.value_ptr.*];

        const hash_increment: u32 = 32 / @intFromEnum(rand_byte_count);
        if (i % hash_increment == 0) {
            // this is the same to below Rust implementation
            // cached_hash_input[32..36].copy_from_slice(&(i / hash_increment).to_le_bytes());
            std.mem.writeInt(u32, cached_hash_input[32..][0..4], i / hash_increment, .little);

            Sha256.hash(cached_hash_input[0..], cached_hash[0..], .{});
        }

        const random_bytes = cached_hash;
        const random_value: u16 = switch (rand_byte_count) {
            .One => blk: {
                const offset = i % hash_increment;
                break :blk @intCast(random_bytes[offset]);
            },
            .Two => blk: {
                const offset = (i % hash_increment) * 2;
                break :blk std.mem.readInt(u16, random_bytes[offset..][0..2], .little);
            },
        };

        const candidate_effective_balance_increment = effective_balance_increments[@intCast(candidate_index)];
        if (candidate_effective_balance_increment * max_random_value >= max_effective_balance_increment * random_value) {
            out[next_committee_index] = candidate_index;
            next_committee_index += 1;
        }

        i += 1;
    }
}

test "ComputeShuffledIndex" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** 32;
    const index_count = 1000;
    // SHUFFLE_ROUND_COUNT is 90 in ethereum mainnet
    const rounds = 90;

    var instance = try ComputeShuffledIndex.init(allocator, seed[0..], index_count, rounds);
    defer instance.deinit();

    const expected = [_]u32{ 789, 161, 541, 509, 498, 445, 270, 2, 505, 621, 947, 550, 338, 814, 285, 597, 169, 819, 644, 638, 751, 514, 750, 523, 303, 231, 391, 982, 409, 396, 641, 837 };

    for (0..index_count) |i| {
        if (i < 32) {
            const shuffled_index = try instance.get(@intCast(i));
            try std.testing.expectEqual(expected[i], shuffled_index);
        }
    }
}

test "compute_proposer_index" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{1} ** 32;
    const index_count = 1000;
    // SHUFFLE_ROUND_COUNT is 90 in ethereum mainnet
    const rounds = 90;
    var active_indices = [_]u32{0} ** index_count;
    for (0..index_count) |i| {
        active_indices[i] = @intCast(i);
    }
    var effective_balance_increments = [_]u16{0} ** index_count;
    for (0..index_count) |i| {
        effective_balance_increments[i] = @intCast(32 + 32 * (i % 64));
    }
    // phase0
    const MAX_EFFECTIVE_BALANCE: u64 = 32000000000;
    const EFFECTIVE_BALANCE_INCREMENT: u32 = 1000000000;
    const phase0_index = try computeProposerIndex(
        allocator,
        seed[0..],
        active_indices[0..],
        effective_balance_increments[0..],
        ByteCount.One,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
    );
    try std.testing.expectEqual(789, phase0_index);

    // electra
    const MAX_EFFECTIVE_BALANCE_ELECTRA: u64 = 2048000000000;
    const electra_index = try computeProposerIndex(
        allocator,
        seed[0..],
        active_indices[0..],
        effective_balance_increments[0..],
        ByteCount.Two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
    );
    try std.testing.expectEqual(161, electra_index);
}

test "compute_sync_committee_indices" {
    const allocator = std.testing.allocator;
    const seed = [_]u8{ 74, 7, 102, 54, 84, 136, 68, 56, 19, 191, 186, 58, 72, 53, 151, 49, 220, 123, 42, 116, 59, 7, 73, 162, 110, 145, 93, 199, 163, 66, 85, 34 };
    const vc = 1000;
    // SHUFFLE_ROUND_COUNT is 90 in ethereum mainnet
    const rounds = 90;
    var active_indices = [_]u32{0} ** vc;
    for (0..vc) |i| {
        active_indices[i] = @intCast(i);
    }
    var effective_balance_increments = [_]u16{0} ** vc;
    for (0..vc) |i| {
        effective_balance_increments[i] = @intCast(32 + 32 * (i % 64));
    }

    // only get first 32 indices to make it easier to test
    var out = [_]u64{0} ** 32;

    // phase0
    const MAX_EFFECTIVE_BALANCE: u64 = 32000000000;
    const EFFECTIVE_BALANCE_INCREMENT: u32 = 1000000000;
    try computeSyncCommitteeIndices(
        allocator,
        seed[0..],
        active_indices[0..],
        effective_balance_increments[0..],
        ByteCount.One,
        MAX_EFFECTIVE_BALANCE,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
        out[0..],
    );
    const expected_phase0 = [_]u64{ 293, 726, 771, 677, 530, 475, 322, 66, 521, 106, 774, 23, 508, 410, 526, 44, 213, 948, 248, 903, 85, 853, 171, 679, 309, 791, 851, 817, 609, 119, 128, 983 };
    try std.testing.expectEqualSlices(u64, expected_phase0[0..], out[0..]);

    // electra
    const MAX_EFFECTIVE_BALANCE_ELECTRA: u64 = 2048000000000;
    try computeSyncCommitteeIndices(
        allocator,
        seed[0..],
        active_indices[0..],
        effective_balance_increments[0..],
        ByteCount.Two,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT,
        rounds,
        out[0..],
    );
    const expected_electra = [_]u64{ 726, 475, 521, 23, 508, 410, 213, 948, 248, 85, 171, 309, 791, 817, 119, 126, 651, 416, 273, 471, 739, 290, 588, 840, 665, 945, 496, 158, 757, 616, 226, 766 };
    try std.testing.expectEqualSlices(u64, expected_electra[0..], out[0..]);
}
