//! Shared utilities for state transition benchmarks

const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const types = @import("consensus_types");
const config = @import("config");
const fork_types = @import("fork_types");
const CachedBeaconState = @import("state_transition").CachedBeaconState;

const ForkSeq = config.ForkSeq;
const AnyBeaconState = fork_types.AnyBeaconState;
const AnySignedBeaconBlock = fork_types.AnySignedBeaconBlock;
const Slot = types.primitive.Slot.Type;

pub const BenchState = struct {
    var allocator: std.mem.Allocator = undefined;
    var cached_state: *CachedBeaconState = undefined;
    pub var cloned_cached_state: *CachedBeaconState = undefined;

    pub fn init(alloc: std.mem.Allocator, state: *CachedBeaconState) void {
        allocator = alloc;
        cached_state = state;
    }

    pub fn beforeEach() void {
        cloned_cached_state = cached_state.clone(allocator, .{}) catch unreachable;
    }

    pub fn afterEach() void {
        cloned_cached_state.deinit();
        allocator.destroy(cloned_cached_state);
    }
};

/// Read slot from raw BeaconState SSZ bytes (offset 40)
pub fn slotFromStateBytes(state_bytes: []const u8) Slot {
    std.debug.assert(state_bytes.len >= 48);
    return std.mem.readInt(u64, state_bytes[40..48], .little);
}

/// Read slot from raw SignedBeaconBlock SSZ bytes (offset 100)
pub fn slotFromBlockBytes(block_bytes: []const u8) Slot {
    std.debug.assert(block_bytes.len >= 108);
    return std.mem.readInt(u64, block_bytes[100..108], .little);
}

/// Load and deserialize BeaconState from SSZ bytes for a specific fork
pub fn loadState(comptime fork: ForkSeq, allocator: std.mem.Allocator, pool: *Node.Pool, state_bytes: []const u8) !*AnyBeaconState {
    const beacon_state = try allocator.create(AnyBeaconState);
    errdefer allocator.destroy(beacon_state);
    beacon_state.* = try AnyBeaconState.deserialize(allocator, pool, fork, state_bytes);
    return beacon_state;
}

/// Load and deserialize SignedBeaconBlock from SSZ bytes for a specific fork
pub fn loadBlock(comptime fork: ForkSeq, allocator: std.mem.Allocator, block_bytes: []const u8) !AnySignedBeaconBlock {
    return try AnySignedBeaconBlock.deserialize(allocator, .full, fork, block_bytes);
}
