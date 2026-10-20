const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const BeaconState = @import("fork_types").BeaconState;
const ForkSeq = @import("config").ForkSeq;
const getSeed = @import("./seed.zig").getSeed;
const c = @import("constants");
const innerShuffleList = @import("swap_or_not_shuffle").innerShuffleList;
const Epoch = types.primitive.Epoch.Type;
const computeStartSlotAtEpoch = @import("./epoch.zig").computeStartSlotAtEpoch;
const getBlockRootAtSlot = @import("./block_root.zig").getBlockRootAtSlot;
const AnchorCheckpoint = @import("../AnchorCheckpoint.zig");
const RefCount = @import("./ref_count.zig").RefCount;

pub const EpochShufflingRc = RefCount(*EpochShuffling);

const Committee = []const u32;
const SlotCommittees = []const Committee;
const EpochCommittees = [preset.SLOTS_PER_EPOCH]SlotCommittees;

/// EpochCache is the only consumer of this cache but an instance of EpochShuffling is shared across EpochCache instances
/// no EpochCache instance takes the ownership of shuffling
/// instead of that, we count on reference counting to deallocate the memory, see RefCount() utility
pub const EpochShuffling = struct {
    allocator: Allocator,

    epoch: Epoch,
    // EpochShuffling takes ownership of all properties below
    active_indices: []const u32,

    shuffling: []const u32,

    /// the internal last-level committee shared the same data with `shuffling` so don't need to free it
    committees: EpochCommittees,

    committees_per_slot: usize,

    /// Takes ownership of `active_indices` on success; the caller retains ownership on failure.
    pub fn init(allocator: Allocator, seed: [32]u8, epoch: Epoch, active_indices: []const u32) !*EpochShuffling {
        if (active_indices.len > std.math.maxInt(u32)) return error.InvalidActiveIndicesLength;

        const shuffling = try allocator.dupe(u32, active_indices);
        errdefer allocator.free(shuffling);
        try unshuffleList(shuffling, seed[0..], preset.SHUFFLE_ROUND_COUNT);

        const committees = try buildCommitteesFromShuffling(allocator, shuffling);
        errdefer for (committees) |slot_committees| {
            allocator.free(slot_committees);
        };

        const epoch_shuffling_ptr = try allocator.create(EpochShuffling);
        epoch_shuffling_ptr.* = EpochShuffling{
            .allocator = allocator,
            .epoch = epoch,
            .active_indices = active_indices,
            .shuffling = shuffling,
            .committees = committees,
            .committees_per_slot = computeCommitteeCount(active_indices.len),
        };

        return epoch_shuffling_ptr;
    }

    pub fn deinit(self: *EpochShuffling) void {
        for (self.committees) |committees_per_slot| {
            // no need to free each committee since they are slices of `shuffling`
            self.allocator.free(committees_per_slot);
        }
        self.allocator.free(self.active_indices);
        self.allocator.free(self.shuffling);
        // no need to free `commitees` because it's stack allocation
        self.allocator.destroy(self);
    }

    fn buildCommitteesFromShuffling(allocator: Allocator, shuffling: []const u32) !EpochCommittees {
        const active_validator_count = shuffling.len;
        const committees_per_slot = computeCommitteeCount(active_validator_count);
        const committee_count = committees_per_slot * preset.SLOTS_PER_EPOCH;

        var epoch_committees: [preset.SLOTS_PER_EPOCH]SlotCommittees = undefined;
        var initialized_count: usize = 0;
        errdefer for (epoch_committees[0..initialized_count]) |slot_committees| {
            allocator.free(slot_committees);
        };
        for (0..preset.SLOTS_PER_EPOCH) |slot| {
            const slot_committees = try allocator.alloc(Committee, committees_per_slot);
            for (0..committees_per_slot) |committee_index| {
                const index = slot * committees_per_slot + committee_index;
                const start_offset = @divFloor(active_validator_count * index, committee_count);
                const end_offset = @divFloor(active_validator_count * (index + 1), committee_count);
                slot_committees[committee_index] = shuffling[start_offset..end_offset];
            }
            epoch_committees[slot] = slot_committees;
            initialized_count += 1;
        }

        return epoch_committees;
    }
};

test EpochShuffling {
    const validator_count_arr = comptime [_]usize{ 256, 2_000_000 };
    inline for (validator_count_arr) |validator_count| {
        const allocator = std.testing.allocator;
        const seed: [32]u8 = [_]u8{0} ** 32;
        const active_indices = try allocator.alloc(u32, validator_count);
        // active_indices is transferred to EpochShuffling so no need to free it here
        for (0..validator_count) |i| {
            active_indices[i] = @intCast(i);
        }

        var epoch_shuffling = try EpochShuffling.init(allocator, seed, 0, active_indices);
        defer epoch_shuffling.deinit();
    }
}

/// Takes ownership of `active_indices` on success; the caller retains ownership on failure.
pub fn computeEpochShuffling(allocator: Allocator, state: *AnyBeaconState, active_indices: []u32, epoch: Epoch) !*EpochShuffling {
    return switch (state.forkSeq()) {
        inline else => |f| computeEpochShufflingForFork(f, allocator, state.castToFork(f), active_indices, epoch),
    };
}

/// Takes ownership of `active_indices` on success; the caller retains ownership on failure.
pub fn computeEpochShufflingForFork(
    comptime fork: ForkSeq,
    allocator: Allocator,
    state: *BeaconState(fork),
    active_indices: []u32,
    epoch: Epoch,
) !*EpochShuffling {
    var seed = [_]u8{0} ** 32;
    try getSeed(fork, state, epoch, c.DOMAIN_BEACON_ATTESTER, &seed);
    return EpochShuffling.init(allocator, seed, epoch, active_indices);
}

/// Unshuffle validator indices in place synchronously.
fn unshuffleList(indices: []u32, seed: []const u8, rounds: u8) !void {
    const forwards = false;
    return innerShuffleList(u32, indices, seed, rounds, forwards);
}

test unshuffleList {
    var active_indices: [5]u32 = .{ 0, 1, 2, 3, 4 };
    const seed: [32]u8 = [_]u8{0} ** 32;

    try unshuffleList(&active_indices, &seed, 32);
}

fn computeCommitteeCount(active_validator_count: usize) usize {
    const validators_per_slot = @divFloor(active_validator_count, preset.SLOTS_PER_EPOCH);
    const committees_per_slot = @divFloor(validators_per_slot, preset.TARGET_COMMITTEE_SIZE);
    return @max(1, @min(preset.MAX_COMMITTEES_PER_SLOT, committees_per_slot));
}

test computeCommitteeCount {
    const committee_count = computeCommitteeCount(2_000_000);
    try std.testing.expectEqual(preset.MAX_COMMITTEES_PER_SLOT, committee_count);
    try std.testing.expectEqual(1, computeCommitteeCount(0));
}

/// Calculate the decision root for a given epoch.
pub fn calculateDecisionRoot(state: *AnyBeaconState, epoch: Epoch) ![32]u8 {
    const pivot_slot = computeStartSlotAtEpoch(epoch -| 1) -| 1;
    const block_root = switch (state.forkSeq()) {
        inline else => |f| try getBlockRootAtSlot(f, state.castToFork(f), pivot_slot),
    };

    return block_root.*;
}

/// Get the shuffling decision block root for the given epoch of given state.
pub fn calculateShufflingDecisionRoot(state: *AnyBeaconState, epoch: Epoch) ![32]u8 {
    const slot = try state.slot();

    if (slot > c.GENESIS_SLOT) {
        return try calculateDecisionRoot(state, epoch);
    }

    const anchor = try AnchorCheckpoint.fromState(state);
    return anchor.checkpoint.root;
}

test {
    _ = @import("epoch_shuffling_test.zig");
}
