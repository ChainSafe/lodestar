//! Tests for `ssz_bytes.zig`.

const std = @import("std");
const types = @import("consensus_types");
const Slot = types.primitive.Slot.Type;
const testing = std.testing;
const getLastProcessedSlotFromStateBytes = @import("ssz_bytes.zig").getLastProcessedSlotFromStateBytes;
const getStateSlotFromBytes = @import("ssz_bytes.zig").getStateSlotFromBytes;

test "state byte readers match a real serialized electra state" {
    var state = types.electra.BeaconState.default_value;
    state.slot = 12_345;
    state.latest_block_header.slot = 12_344;

    const bytes = try testing.allocator.alloc(u8, types.electra.BeaconState.serializedSize(&state));
    defer testing.allocator.free(bytes);
    _ = types.electra.BeaconState.serializeIntoBytes(&state, bytes);

    try testing.expectEqual(@as(Slot, 12_345), try getStateSlotFromBytes(bytes));
    try testing.expectEqual(@as(Slot, 12_344), try getLastProcessedSlotFromStateBytes(bytes));
}

test "state byte readers match a real serialized phase0 state" {
    var state = types.phase0.BeaconState.default_value;
    state.slot = 77;
    state.latest_block_header.slot = 76;

    const bytes = try testing.allocator.alloc(u8, types.phase0.BeaconState.serializedSize(&state));
    defer testing.allocator.free(bytes);
    _ = types.phase0.BeaconState.serializeIntoBytes(&state, bytes);

    try testing.expectEqual(@as(Slot, 77), try getStateSlotFromBytes(bytes));
    try testing.expectEqual(@as(Slot, 76), try getLastProcessedSlotFromStateBytes(bytes));
}
