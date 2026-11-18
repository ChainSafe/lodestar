const std = @import("std");
const Allocator = std.mem.Allocator;
const Sha256 = std.crypto.hash.sha2.Sha256;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const EpochShuffling = @import("../utils/epoch_shuffling.zig").EpochShuffling;
const computeEpochShufflingForFork = @import("../utils/epoch_shuffling.zig").computeEpochShufflingForFork;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const computeStartSlotAtEpoch = @import("../utils/epoch.zig").computeStartSlotAtEpoch;
const getSeed = @import("../utils/seed.zig").getSeed;
const computePtcIndicesInto = @import("swap_or_not_shuffle").computePtcIndicesInto;
const preset = @import("preset").preset;
const c = @import("constants");

const fork = ForkSeq.pq;
const AggregationCommittees = ForkTypes(fork).AggregationCommittees;
const Window = ForkTypes(fork).AggregationCommitteeWindow;

/// The aggregators of `committee`, sampled by effective balance without
/// duplicates. `epoch_seed` is the epoch's seed for `DOMAIN_SELECTION_PROOF`.
fn computeAggregationCommittee(
    allocator: Allocator,
    epoch_seed: *const [32]u8,
    slot: u64,
    index: u64,
    committee: []const u32,
    effective_balance_increments: []const u16,
    out: *ForkTypes(fork).AggregationCommittee.Type,
) !void {
    var seed_input: [48]u8 = undefined;
    @memcpy(seed_input[0..32], epoch_seed);
    std.mem.writeInt(u64, seed_input[32..40], slot, .little);
    std.mem.writeInt(u64, seed_input[40..48], index, .little);
    var pick_input: [40]u8 = undefined;
    Sha256.hash(&seed_input, pick_input[0..32], .{});

    const candidates = try allocator.dupe(u32, committee);
    defer allocator.free(candidates);
    var len = candidates.len;
    try out.ensureTotalCapacity(allocator, @min(c.AGGREGATORS_PER_COMMITTEE, len));
    while (out.items.len < c.AGGREGATORS_PER_COMMITTEE and len > 0) {
        std.mem.writeInt(u64, pick_input[32..40], out.items.len, .little);
        var seed: [32]u8 = undefined;
        Sha256.hash(&pick_input, &seed, .{});
        var picked: [1]u32 = undefined;
        try computePtcIndicesInto(
            &seed,
            candidates[0..len],
            effective_balance_increments,
            preset.MAX_EFFECTIVE_BALANCE_ELECTRA,
            preset.EFFECTIVE_BALANCE_INCREMENT,
            &picked,
        );
        out.appendAssumeCapacity(picked[0]);
        const at = std.mem.indexOfScalar(u32, candidates[0..len], picked[0]).?;
        std.mem.copyForwards(u32, candidates[at .. len - 1], candidates[at + 1 .. len]);
        len -= 1;
    }
}

/// The aggregation committee of each beacon committee of each slot of `shuffling`'s epoch.
pub fn computeAggregationCommitteesForEpoch(
    allocator: Allocator,
    state: *BeaconState(fork),
    shuffling: *const EpochShuffling,
    effective_balance_increments: []const u16,
) ![preset.SLOTS_PER_EPOCH]AggregationCommittees.Type {
    var epoch_seed: [32]u8 = undefined;
    try getSeed(fork, state, shuffling.epoch, c.DOMAIN_SELECTION_PROOF, &epoch_seed);
    const start_slot = computeStartSlotAtEpoch(shuffling.epoch);
    var result: [preset.SLOTS_PER_EPOCH]AggregationCommittees.Type = @splat(.empty);
    errdefer for (&result) |*committees| AggregationCommittees.deinit(allocator, committees);
    for (&result, shuffling.committees, 0..) |*committees, slot_committees, slot_offset| {
        try committees.ensureTotalCapacity(allocator, slot_committees.len);
        for (slot_committees, 0..) |committee, index| {
            const aggregators = committees.addOneAssumeCapacity();
            aggregators.* = .empty;
            try computeAggregationCommittee(allocator, &epoch_seed, start_slot + slot_offset, index, committee, effective_balance_increments, aggregators);
        }
    }
    return result;
}

/// Shifts the window by an epoch and fills in the last one.
pub fn processAggregationCommitteeWindow(
    comptime f: ForkSeq,
    allocator: Allocator,
    epoch_cache: *const EpochCache,
    state: *BeaconState(f),
    cache: *EpochTransitionCache,
) !void {
    comptime std.debug.assert(f == fork);
    const next_epoch = computeEpochAtSlot(try state.slot()) + preset.MIN_SEED_LOOKAHEAD + 1;
    var owned_shuffling: ?*EpochShuffling = null;
    defer if (owned_shuffling) |shuffling| shuffling.deinit();
    const shuffling = if (cache.next_shuffling) |shared| shared.get() else blk: {
        const indices = try allocator.dupe(u32, cache.next_shuffling_active_indices);
        errdefer allocator.free(indices);
        owned_shuffling = try computeEpochShufflingForFork(fork, allocator, state, indices, next_epoch);
        break :blk owned_shuffling.?;
    };
    var committees = try computeAggregationCommitteesForEpoch(allocator, state, shuffling, epoch_cache.getEffectiveBalanceIncrements().items);
    defer for (&committees) |*slot_committees| AggregationCommittees.deinit(allocator, slot_committees);

    var window = try state.inner.get("aggregation_committee_window");
    const kept = Window.length - preset.SLOTS_PER_EPOCH;
    for (0..kept) |i| {
        var old = try window.getReadonly(i + preset.SLOTS_PER_EPOCH);
        const retained = try old.clone(.{ .transfer_cache = false });
        errdefer retained.deinit();
        try window.set(i, retained);
    }
    for (&committees, 0..) |*slot_committees, i| try window.setValue(kept + i, slot_committees);
}
