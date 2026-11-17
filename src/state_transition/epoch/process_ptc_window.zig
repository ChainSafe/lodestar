const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const EpochShuffling = @import("../utils/epoch_shuffling.zig").EpochShuffling;
const preset = @import("preset").preset;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const computePayloadTimelinessCommitteesForEpoch = @import("../utils/seed.zig").computePayloadTimelinessCommitteesForEpoch;
const computeEpochShufflingForFork = @import("../utils/epoch_shuffling.zig").computeEpochShufflingForFork;

pub fn processPtcWindow(
    comptime fork: ForkSeq,
    allocator: std.mem.Allocator,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *EpochTransitionCache,
) !void {
    const next_epoch = computeEpochAtSlot(try state.slot()) + preset.MIN_SEED_LOOKAHEAD + 1;
    var owned_shuffling: ?*EpochShuffling = null;
    defer if (owned_shuffling) |shuffling| shuffling.deinit();
    const shuffling = if (cache.next_shuffling) |shared| shared.get() else blk: {
        const indices = try allocator.dupe(u32, cache.next_shuffling_active_indices);
        errdefer allocator.free(indices);
        owned_shuffling = try computeEpochShufflingForFork(fork, allocator, state, indices, next_epoch);
        break :blk owned_shuffling.?;
    };
    const committees = try computePayloadTimelinessCommitteesForEpoch(fork, state, next_epoch, shuffling, epoch_cache.getEffectiveBalanceIncrements().items);
    var window = try state.inner.get("ptc_window");
    for (0..ForkTypes(fork).PtcWindow.length - preset.SLOTS_PER_EPOCH) |i| {
        var old = try window.getReadonly(i + preset.SLOTS_PER_EPOCH);
        const retained = try old.clone(.{ .transfer_cache = false });
        errdefer retained.deinit();
        try window.set(i, retained);
    }
    for (&committees, 0..) |*committee, i| try window.setValue(ForkTypes(fork).PtcWindow.length - preset.SLOTS_PER_EPOCH + i, committee);
}
