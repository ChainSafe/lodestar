//! Port of https://github.com/ChainSafe/swap-or-not-shuffle/blob/main/src/lib.rs

const std = @import("std");
const Allocator = std.mem.Allocator;
const Sha256 = std.crypto.hash.sha2.Sha256;

pub const SHUFFLE_ROUNDS_MINIMAL: u32 = 10;
pub const SHUFFLE_ROUNDS_MAINNET: u32 = 90;

pub const SEED_SIZE = 32;
const ROUND_SIZE = 1;
const POSITION_WINDOW_SIZE = 4;
const PIVOT_VIEW_SIZE = SEED_SIZE + ROUND_SIZE;
const TOTAL_SIZE = SEED_SIZE + ROUND_SIZE + POSITION_WINDOW_SIZE;

pub const ShufflingError = error{
    InvalidSeedLength,
    InvalidActiveIndicesLength,
    InvalidNumberOfRounds,
};

/// A helper struct to manage the buffer used during shuffling.
const ShufflingManager = struct {
    buf: [TOTAL_SIZE]u8,

    fn init(seed: []const u8) ShufflingError!ShufflingManager {
        if (seed.len != SEED_SIZE) {
            return error.InvalidSeedLength;
        }
        var buf = [_]u8{0} ** TOTAL_SIZE;
        @memcpy(buf[0..SEED_SIZE], seed);
        return .{ .buf = buf };
    }

    /// Set the shuffling round.
    fn setRound(self: *ShufflingManager, round: u8) void {
        self.buf[SEED_SIZE] = round;
    }

    /// Returns the new pivot. It is "raw" because it has not modulo the list
    /// size (this must be done by the caller).
    fn rawPivot(self: *const ShufflingManager) u64 {
        var digest: [Sha256.digest_length]u8 = undefined;
        Sha256.hash(self.buf[0..PIVOT_VIEW_SIZE], &digest, .{});
        return std.mem.readInt(u64, digest[0..@sizeOf(u64)], .little);
    }

    /// Add the current position into the buffer.
    fn mixInPosition(self: *ShufflingManager, position: usize) void {
        std.mem.writeInt(u32, self.buf[PIVOT_VIEW_SIZE..][0..POSITION_WINDOW_SIZE], @truncate(position), .little);
    }

    /// Hash the entire buffer.
    fn hash(self: *const ShufflingManager) [Sha256.digest_length]u8 {
        var digest: [Sha256.digest_length]u8 = undefined;
        Sha256.hash(self.buf[0..TOTAL_SIZE], &digest, .{});
        return digest;
    }
};

inline fn maskedSwap(comptime T: type, out: []T, i: usize, j: usize, bit: u8) void {
    std.debug.assert(bit <= 1);

    // Bit 0 makes delta zero, preserving both values. Bit 1 makes delta left ^ right,
    // so left ^ delta = right and right ^ delta = left.
    const mask = @as(T, 0) -% @as(T, bit);
    const left = out[i];
    const right = out[j];
    const delta = (left ^ right) & mask;
    out[i] = left ^ delta;
    out[j] = right ^ delta;
}

const PAIRS_PER_SOURCE_BYTE = 8;

/// Swaps `out[low + k]` with `out[high - k]` for each k in 0..8 whose bit `7 - k` of
/// `source_byte` is set. Requires `high & 7 == 7`, so one source byte decides all eight pairs.
inline fn maskedSwapBlock(
    comptime T: type,
    out: []T,
    low: usize,
    high: usize,
    source_byte: u8,
) void {
    const Block = @Vector(PAIRS_PER_SOURCE_BYTE, T);
    const Bits = @Vector(PAIRS_PER_SOURCE_BYTE, u8);
    const lane_bit: Bits = .{ 1, 2, 4, 8, 16, 32, 64, 128 };

    std.debug.assert(high & 0x07 == 0x07);
    const high_start = high - (PAIRS_PER_SOURCE_BYTE - 1);
    std.debug.assert(low + PAIRS_PER_SOURCE_BYTE <= high_start);

    const low_block: Block = out[low..][0..PAIRS_PER_SOURCE_BYTE].*;
    const high_block: Block = out[high_start..][0..PAIRS_PER_SOURCE_BYTE].*;
    // Lane m of the high block is pair `7 - m`, which bit m decides. Reversing the low block
    // puts its half of each pair in the same lane.
    const low_reversed = std.simd.reverseOrder(low_block);
    const swap = (@as(Bits, @splat(source_byte)) & lane_bit) != @as(Bits, @splat(0));

    out[low..][0..PAIRS_PER_SOURCE_BYTE].* =
        std.simd.reverseOrder(@select(T, swap, high_block, low_reversed));
    out[high_start..][0..PAIRS_PER_SOURCE_BYTE].* = @select(T, swap, low_reversed, high_block);
}

/// Applies the current round's swap-or-not to `pair_count` pairs, walking up from `low_first`
/// and down from `high_first`. The high position of a pair selects its decision bit.
fn swapOrNotPairs(
    comptime T: type,
    out: []T,
    manager: *ShufflingManager,
    low_first: usize,
    high_first: usize,
    pair_count: usize,
) void {
    std.debug.assert(high_first < out.len);
    std.debug.assert(low_first + 2 * pair_count <= high_first + 1);

    manager.mixInPosition(high_first >> 8);
    var source = manager.hash();
    var byte_v = source[(high_first & 0xff) >> 3];

    var pair: usize = 0;
    while (pair < pair_count) {
        const i = low_first + pair;
        const j = high_first - pair;

        if (j & 0xff == 0xff) {
            manager.mixInPosition(j >> 8);
            source = manager.hash();
        }

        if (j & 0x07 == 0x07) {
            byte_v = source[(j & 0xff) >> 3];
            if (pair_count - pair >= PAIRS_PER_SOURCE_BYTE) {
                maskedSwapBlock(T, out, i, j, byte_v);
                pair += PAIRS_PER_SOURCE_BYTE;
                continue;
            }
        }
        const bit_v = (byte_v >> @intCast(j & 0x07)) & 0x01;

        maskedSwap(T, out, i, j, bit_v);
        pair += 1;
    }
}

/// Shuffles an entire list in-place, equivalent to running
/// `compute_shuffled_index` over every index but ~250x faster on large lists.
/// Algorithm by [@protolambda](https://github.com/protolambda).
///
/// Shuffles if `forwards`, otherwise un-shuffles; each is the other's inverse.
///
/// `T` is `u32` for the JS binding and `ValidatorIndex`/`u64` for Zig callers.
pub fn innerShuffleList(comptime T: type, out: []T, seed: []const u8, rounds: i32, forwards: bool) ShufflingError!void {
    if (rounds == 0) {
        // no shuffling rounds
        return;
    }

    const list_size = out.len;

    if (list_size <= 1) {
        // nothing to (un)shuffle
        return;
    }

    if (list_size > std.math.maxInt(u32)) {
        return error.InvalidActiveIndicesLength;
    }

    var manager = try ShufflingManager.init(seed);

    if (rounds < 0 or rounds > std.math.maxInt(u8)) {
        return error.InvalidNumberOfRounds;
    }

    const rounds_u8: u8 = @intCast(rounds);
    var current_round: u8 = if (forwards) 0 else rounds_u8 - 1;

    while (true) {
        manager.setRound(current_round);

        // get raw pivot and modulo by list size to account for wrap around to
        // guarantee pivot is within length
        const pivot = manager.rawPivot() % list_size;

        // swap-or-not from beginning of list to mirror point
        const mirror_low = (pivot + 1) >> 1;
        swapOrNotPairs(T, out, &manager, 0, pivot, mirror_low);

        // swap-or-not from just past the pivot to the mirror point of the rest of the list
        const mirror_high = (pivot + list_size + 1) >> 1;
        swapOrNotPairs(T, out, &manager, pivot + 1, list_size - 1, mirror_high - (pivot + 1));

        // update current_round and stop when reaching the end of the
        // predetermined rounds
        if (forwards) {
            current_round += 1;
            if (current_round == rounds_u8) {
                break;
            }
        } else {
            if (current_round == 0) {
                break;
            }
            current_round -= 1;
        }
    }
}

/// Forwards-shuffles `out` in-place.
pub fn shuffleList(comptime T: type, out: []T, seed: []const u8, rounds: i32) ShufflingError!void {
    return innerShuffleList(T, out, seed, rounds, true);
}

/// Un-shuffles `out` in-place (inverse of `shuffleList`).
pub fn unshuffleList(comptime T: type, out: []T, seed: []const u8, rounds: i32) ShufflingError!void {
    return innerShuffleList(T, out, seed, rounds, false);
}

/// `compute_shuffled_index` for single indices, caching per-round pivots and
/// source hashes across calls.
pub const ComputeShuffledIndex = struct {
    /// The caches below are written until `deinit` and never freed piecemeal,
    /// so an arena keeps their many small allocations to one teardown.
    arena: std.heap.ArenaAllocator,
    /// Lazily computed pivot per round; there are at most `rounds` values.
    pivot_by_round: []?u32,
    /// Unmanaged: a managed map would capture a pointer to init's stack frame.
    source_by_position_by_round: []std.AutoHashMapUnmanaged(u32, [32]u8),
    /// 32 bytes seed + 1 byte round
    pivot_buffer: [PIVOT_VIEW_SIZE]u8,
    /// 32 bytes seed + 1 byte round + 4 bytes position_div
    source_buffer: [TOTAL_SIZE]u8,
    index_count: u32,
    rounds: u32,

    pub fn init(parent_allocator: Allocator, seed: []const u8, index_count: u32, rounds: u32) !ComputeShuffledIndex {
        if (seed.len != SEED_SIZE) {
            return error.InvalidSeedLength;
        }

        var arena = std.heap.ArenaAllocator.init(parent_allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        const pivot_by_round = try allocator.alloc(?u32, rounds);
        @memset(pivot_by_round, null);

        const source_by_position_by_round = try allocator.alloc(std.AutoHashMapUnmanaged(u32, [32]u8), rounds);
        @memset(source_by_position_by_round, .empty);

        var pivot_buffer = [_]u8{0} ** PIVOT_VIEW_SIZE;
        var source_buffer = [_]u8{0} ** TOTAL_SIZE;
        @memcpy(pivot_buffer[0..SEED_SIZE], seed);
        @memcpy(source_buffer[0..SEED_SIZE], seed);

        return .{
            .arena = arena,
            .pivot_by_round = pivot_by_round,
            .source_by_position_by_round = source_by_position_by_round,
            .pivot_buffer = pivot_buffer,
            .source_buffer = source_buffer,
            .index_count = index_count,
            .rounds = rounds,
        };
    }

    pub fn deinit(self: *ComputeShuffledIndex) void {
        // pivot_by_round and source_by_position_by_round are arena-owned
        self.arena.deinit();
    }

    pub fn get(self: *ComputeShuffledIndex, index: u32) !u32 {
        // u32 wrapping arithmetic mirrors the reference's release-mode u32
        // arithmetic: for valid inputs (index < index_count) this is
        // arithmetically identical to non-wrapping math, so out-of-range
        // indices produce the same (garbage but deterministic) values as the
        // reference instead of panicking.
        const index_count: u32 = self.index_count;
        var permuted: u32 = index;

        for (0..self.rounds) |round| {
            const pivot: u32 = self.pivot_by_round[round] orelse blk: {
                self.pivot_buffer[SEED_SIZE] = @intCast(round % 256);
                var digest: [Sha256.digest_length]u8 = undefined;
                Sha256.hash(&self.pivot_buffer, &digest, .{});
                const pivot: u32 = @intCast(std.mem.readInt(u64, digest[0..8], .little) % index_count);
                self.pivot_by_round[round] = pivot;
                break :blk pivot;
            };

            const flip = (pivot +% index_count -% permuted) % index_count;
            const position = @max(permuted, flip);
            const position_div: u32 = @intCast(position / 256);

            const source = try self.source_by_position_by_round[round].getOrPut(self.arena.allocator(), position_div);
            if (!source.found_existing) {
                self.source_buffer[SEED_SIZE] = @intCast(round % 256);
                std.mem.writeInt(u32, self.source_buffer[PIVOT_VIEW_SIZE..][0..POSITION_WINDOW_SIZE], position_div, .little);
                Sha256.hash(&self.source_buffer, source.value_ptr, .{});
            }

            const byte = source.value_ptr[@intCast(position % 256 / 8)];
            const bit = (byte >> @intCast(position % 8)) & 1;
            permuted = if (bit == 1) flip else permuted;
        }

        return permuted;
    }
};

/// Pre-electra the byte count for the random value is 1, post-electra it is 2.
pub const ByteCount = enum(u8) {
    one = 1,
    two = 2,
};

/// Draws `committee_size` indices from `active_indices` weighted by effective
/// balance. Caller owns the returned slice.
pub fn getCommitteeIndices(
    allocator: Allocator,
    committee_size: u32,
    seed: []const u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    rand_byte_count: ByteCount,
    max_effective_balance: i64,
    effective_balance_increment: i64,
    rounds: u32,
) ![]u32 {
    // reference divergence: error instead of risking invoking unchecked arithmetic
    if (active_indices.len == 0) {
        return error.EmptyActiveIndices;
    }
    if (effective_balance_increment == 0) {
        return error.InvalidEffectiveBalanceIncrement;
    }

    var committee_indices = try std.ArrayList(u32).initCapacity(allocator, committee_size);
    errdefer committee_indices.deinit(allocator);

    const max_random_value: i64 = switch (rand_byte_count) {
        .one => 0xff,
        .two => 0xffff,
    };
    const hash_increment: u32 = switch (rand_byte_count) {
        .one => 32,
        .two => 16,
    };
    const max_effective_balance_increment = @divTrunc(max_effective_balance, effective_balance_increment);

    var compute_shuffled_index = try ComputeShuffledIndex.init(allocator, seed, @intCast(active_indices.len), rounds);
    defer compute_shuffled_index.deinit();

    var shuffled_result = std.AutoHashMap(u32, u32).init(allocator);
    defer shuffled_result.deinit();

    var i: u32 = 0;
    // seed + 8 bytes of little-endian counter; only the low 4 bytes are ever
    // written, matching the reference which hashes the full 40-byte buffer.
    var cached_hash_input = [_]u8{0} ** (SEED_SIZE + 8);
    // seed length was validated by ComputeShuffledIndex.init
    @memcpy(cached_hash_input[0..SEED_SIZE], seed);
    var cached_hash: [Sha256.digest_length]u8 = undefined;

    while (committee_indices.items.len < committee_size) {
        const index: u32 = @intCast(i % active_indices.len);
        const shuffled = try shuffled_result.getOrPut(index);
        if (!shuffled.found_existing) {
            shuffled.value_ptr.* = try compute_shuffled_index.get(index);
        }
        const shuffled_index = shuffled.value_ptr.*;
        const candidate_index = active_indices[shuffled_index];

        if (i % hash_increment == 0) {
            std.mem.writeInt(u32, cached_hash_input[SEED_SIZE..][0..4], i / hash_increment, .little);
            Sha256.hash(&cached_hash_input, &cached_hash, .{});
        }

        const random_value: i64 = switch (rand_byte_count) {
            .one => cached_hash[i % 32],
            .two => std.mem.readInt(u16, cached_hash[(i % 16) * 2 ..][0..2], .little),
        };

        if (candidate_index >= effective_balance_increments.len) {
            // the reference panics on the out-of-bounds read
            return error.EffectiveBalanceIncrementsOutOfBounds;
        }
        const candidate_effective_balance_increment: i64 = effective_balance_increments[candidate_index];

        // wrapping multiplies mirror the reference release-mode behavior for
        // absurd (but JS-reachable) maxEffectiveBalanceElectra values; valid
        // inputs never approach overflow so their results are unaffected
        if (candidate_effective_balance_increment *% max_random_value >= max_effective_balance_increment *% random_value) {
            committee_indices.appendAssumeCapacity(candidate_index);
        }

        // wrapping add matches the reference release-mode behavior
        i +%= 1;
    }

    return committee_indices.toOwnedSlice(allocator);
}

pub fn computeProposerIndex(
    allocator: Allocator,
    seed: []const u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    rand_byte_count: ByteCount,
    max_effective_balance: i64,
    effective_balance_increment: i64,
    rounds: u32,
) !u32 {
    const indices = try getCommitteeIndices(
        allocator,
        1,
        seed,
        active_indices,
        effective_balance_increments,
        rand_byte_count,
        max_effective_balance,
        effective_balance_increment,
        rounds,
    );
    defer allocator.free(indices);
    return indices[0];
}

pub fn computeProposerIndexElectra(
    allocator: Allocator,
    seed: []const u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    max_effective_balance_electra: i64,
    effective_balance_increment: i64,
    rounds: u32,
) !u32 {
    return computeProposerIndex(
        allocator,
        seed,
        active_indices,
        effective_balance_increments,
        .two,
        max_effective_balance_electra,
        effective_balance_increment,
        rounds,
    );
}

pub fn computeSyncCommitteeIndices(
    allocator: Allocator,
    seed: []const u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    rand_byte_count: ByteCount,
    sync_committee_size: u32,
    max_effective_balance: i64,
    effective_balance_increment: i64,
    rounds: u32,
) ![]u32 {
    return getCommitteeIndices(
        allocator,
        sync_committee_size,
        seed,
        active_indices,
        effective_balance_increments,
        rand_byte_count,
        max_effective_balance,
        effective_balance_increment,
        rounds,
    );
}

pub fn computeSyncCommitteeIndicesElectra(
    allocator: Allocator,
    seed: []const u8,
    active_indices: []const u32,
    effective_balance_increments: []const u16,
    sync_committee_size: u32,
    max_effective_balance_electra: i64,
    effective_balance_increment: i64,
    rounds: u32,
) ![]u32 {
    return computeSyncCommitteeIndices(
        allocator,
        seed,
        active_indices,
        effective_balance_increments,
        .two,
        sync_committee_size,
        max_effective_balance_electra,
        effective_balance_increment,
        rounds,
    );
}

/// Fills `out` by sampling from the pre-shuffled `indices`, weighted by
/// effective balance; one SHA-256 per 16 candidates.
/// Port of https://github.com/ChainSafe/swap-or-not-shuffle/pull/24 (453b639b).
fn computePtcIndicesInner(
    seed: *const [SEED_SIZE]u8,
    indices: []const u32,
    effective_balance_increments: []const u16,
    max_ebi: i64,
    out: []u32,
) !void {
    const max_random_value: i64 = 0xffff;
    const indices_len = indices.len;

    var hash_input = [_]u8{0} ** (SEED_SIZE + 8);
    @memcpy(hash_input[0..SEED_SIZE], seed);

    var digest: [Sha256.digest_length]u8 = undefined;
    var count: usize = 0;

    var i: usize = 0;
    // bounded by `count` so an empty `out` cannot spin; the inner break still
    // stops mid-block, which also keeps `out[count]` in range
    outer: while (count < out.len) : (i += 16) {
        // one SHA-256 per 16 candidates; encode block index in bytes 32..40
        std.mem.writeInt(u64, hash_input[SEED_SIZE..][0..8], i / 16, .little);
        Sha256.hash(&hash_input, &digest, .{});

        // consume all 16 u16 random values from this hash block
        for (0..16) |j| {
            const candidate_index = indices[(i + j) % indices_len];
            const random_value: i64 = std.mem.readInt(u16, digest[j * 2 ..][0..2], .little);
            if (candidate_index >= effective_balance_increments.len) {
                // the reference panics on the out-of-bounds read
                return error.EffectiveBalanceIncrementsOutOfBounds;
            }
            const ebi: i64 = effective_balance_increments[candidate_index];
            // accept if ebi / max_ebi >= random_value / max_random_value;
            // wrapping multiplies mirror the reference release-mode behavior
            if (ebi *% max_random_value >= max_ebi *% random_value) {
                out[count] = candidate_index;
                count += 1;
                if (count == out.len) {
                    break :outer;
                }
            }
        }
    }
}

/// Samples one slot's payload timeliness committee into `out`, whose length is
/// the committee size. Caller owns `out`.
pub fn computePtcIndicesInto(
    seed: []const u8,
    indices: []const u32,
    effective_balance_increments: []const u16,
    max_effective_balance_electra: i64,
    effective_balance_increment: i64,
    out: []u32,
) !void {
    // The reference panics on a non-32-byte seed and on `% 0`, and divides by
    // zero on a zero increment; return errors instead. An empty `out` is a
    // no-op, where the reference would loop forever.
    if (seed.len != SEED_SIZE) {
        return error.InvalidSeedLength;
    }
    if (indices.len == 0) {
        return error.EmptyActiveIndices;
    }
    if (effective_balance_increment == 0) {
        return error.InvalidEffectiveBalanceIncrement;
    }
    if (out.len == 0) {
        return;
    }

    const max_ebi = @divTrunc(max_effective_balance_electra, effective_balance_increment);
    try computePtcIndicesInner(seed[0..SEED_SIZE], indices, effective_balance_increments, max_ebi, out);
}

/// Samples every slot's payload timeliness committee for an epoch into `out`,
/// which must hold `slots_per_epoch * ptc_size` entries, slot-major.
/// `slot_offsets` (length `slots_per_epoch + 1`) marks each slot's window into
/// the flat `shuffling`; per-slot seed is
/// `sha256(epoch_seed ++ u64le(start_slot + slot))`. Caller owns `out`.
pub fn computePtcIndicesForEpochInto(
    epoch_seed: []const u8,
    start_slot: u32,
    slots_per_epoch: u32,
    shuffling: []const u32,
    slot_offsets: []const u32,
    effective_balance_increments: []const u16,
    ptc_size: u32,
    max_effective_balance_electra: i64,
    effective_balance_increment: i64,
    out: []u32,
) !void {
    // graceful errors where the reference panics (see computePtcIndicesInto)
    if (epoch_seed.len != SEED_SIZE) {
        return error.InvalidSeedLength;
    }
    if (effective_balance_increment == 0) {
        return error.InvalidEffectiveBalanceIncrement;
    }
    const slots: usize = slots_per_epoch;
    if (slot_offsets.len < slots + 1) {
        return error.InvalidSlotOffsets;
    }
    if (out.len != slots * ptc_size) {
        return error.InvalidOutputLength;
    }

    const max_ebi = @divTrunc(max_effective_balance_electra, effective_balance_increment);

    var slot_seed_input = [_]u8{0} ** (SEED_SIZE + 8);
    @memcpy(slot_seed_input[0..SEED_SIZE], epoch_seed);

    for (0..slots) |i| {
        // per-slot seed: sha256(epoch_seed ++ u64le(start_slot + i))
        std.mem.writeInt(u64, slot_seed_input[SEED_SIZE..][0..8], @as(u64, start_slot) + i, .little);
        var slot_seed: [SEED_SIZE]u8 = undefined;
        Sha256.hash(&slot_seed_input, &slot_seed, .{});

        const start = slot_offsets[i];
        const end = slot_offsets[i + 1];
        if (start > end or end > shuffling.len) {
            return error.InvalidSlotOffsets;
        }
        const slot_indices = shuffling[start..end];
        if (slot_indices.len == 0) {
            return error.EmptyActiveIndices;
        }

        if (ptc_size != 0) {
            try computePtcIndicesInner(
                &slot_seed,
                slot_indices,
                effective_balance_increments,
                max_ebi,
                out[i * ptc_size ..][0..ptc_size],
            );
        }
    }
}

test {
    _ = @import("root_test.zig");
}
