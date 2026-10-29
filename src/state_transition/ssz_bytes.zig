const std = @import("std");

const types = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;

const Slot = types.primitive.Slot.Type;

///
/// 8 + 32 = 40
///
/// ```
/// class BeaconState(Container):
///   genesis_time: uint64 [fixed - 8 bytes]
///   genesis_validators_root: Root [fixed - 32 bytes]
///   slot: Slot [fixed - 8 bytes]
///   ...
/// ```
const SLOT_BYTES_POSITION_IN_STATE: usize = 40;

pub fn getStateSlotFromBytes(bytes: []const u8) !Slot {
    const slot_size = types.primitive.Slot.fixed_size;
    if (bytes.len < SLOT_BYTES_POSITION_IN_STATE + slot_size) return error.InvalidSize;
    return std.mem.readInt(u64, bytes[SLOT_BYTES_POSITION_IN_STATE .. SLOT_BYTES_POSITION_IN_STATE + slot_size], .little);
}

///
/// 8 + 32 + 8 + 16 = 64
///
/// ```
/// class BeaconState(Container):
///   genesis_time: uint64 [fixed - 8 bytes]
///   genesis_validators_root: Root [fixed - 32 bytes]
///   slot: Slot [fixed - 8 bytes]
///   fork: Fork [fixed - 16 bytes]
///   latest_block_header: BeaconBlockHeader
///     slot: Slot [fixed - 8 bytes]  <-- this
///   ...
/// ```
const BLOCK_HEADER_SLOT_BYTES_POSITION_IN_STATE: usize = 64;

/// Leading bytes sufficient for both slot readers.
pub const STATE_SLOTS_PREFIX_LEN: usize =
    BLOCK_HEADER_SLOT_BYTES_POSITION_IN_STATE + types.primitive.Slot.fixed_size;

/// Slot of the state's `latest_block_header` — the slot of the last block processed into the state,
/// which lags `state.slot` when slots were skipped after that block.
pub fn getLastProcessedSlotFromStateBytes(bytes: []const u8) !Slot {
    const slot_size = types.primitive.Slot.fixed_size;
    if (bytes.len < BLOCK_HEADER_SLOT_BYTES_POSITION_IN_STATE + slot_size) return error.InvalidSize;
    return std.mem.readInt(u64, bytes[BLOCK_HEADER_SLOT_BYTES_POSITION_IN_STATE .. BLOCK_HEADER_SLOT_BYTES_POSITION_IN_STATE + slot_size], .little);
}

pub fn getForkFromStateBytes(config: *const BeaconConfig, bytes: []const u8) !ForkSeq {
    const slot = try getStateSlotFromBytes(bytes);
    return config.forkSeq(slot);
}

test {
    _ = @import("ssz_bytes_test.zig");
}
