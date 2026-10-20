const std = @import("std");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const preset = @import("preset").preset;
const ZERO_HASH = @import("constants").ZERO_HASH;

pub fn processSlot(state: *AnyBeaconState) !void {

    // Cache state root
    const previous_state_root = try state.hashTreeRoot();
    var state_roots = try state.stateRoots();
    try state_roots.setValue(try state.slot() % preset.SLOTS_PER_HISTORICAL_ROOT, previous_state_root);

    // Cache latest block header state root
    var latest_block_header = try state.latestBlockHeader();
    var latest_header_state_root = try latest_block_header.getFieldRoot("state_root");

    if (std.mem.eql(u8, latest_header_state_root[0..], ZERO_HASH[0..])) {
        try latest_block_header.setValue("state_root", previous_state_root);
    }

    // Cache block root
    const previous_block_root = try latest_block_header.hashTreeRoot();
    var block_roots = try state.blockRoots();
    try block_roots.setValue(try state.slot() % preset.SLOTS_PER_HISTORICAL_ROOT, previous_block_root[0..]);

    switch (state.*) {
        inline else => |inner, fork| {
            if (comptime fork.gte(.gloas)) {
                var availability = try inner.get("execution_payload_availability");
                try availability.set((try state.slot() + 1) % preset.SLOTS_PER_HISTORICAL_ROOT, false);
            }
        },
    }
}

test "Gloas slot processing clears only the next circular payload availability entry" {
    const allocator = std.testing.allocator;
    const Node = @import("persistent_merkle_tree").Node;
    const ct = @import("consensus_types");
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer state.deinit();
    try state.setSlot(preset.SLOTS_PER_HISTORICAL_ROOT - 1);
    var availability = try state.castToFork(.gloas).inner.get("execution_payload_availability");
    try availability.set(0, true);
    try availability.set(preset.SLOTS_PER_HISTORICAL_ROOT - 1, true);
    const before = (try state.hashTreeRoot()).*;
    try processSlot(&state);
    try std.testing.expect(!try availability.get(0));
    try std.testing.expect(try availability.get(preset.SLOTS_PER_HISTORICAL_ROOT - 1));
    var roots = try state.stateRoots();
    var cached_root: [32]u8 = undefined;
    try roots.getValue(undefined, preset.SLOTS_PER_HISTORICAL_ROOT - 1, &cached_root);
    try std.testing.expectEqualSlices(u8, &before, &cached_root);
}
