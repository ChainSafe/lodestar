const types = @import("consensus_types");
const preset = @import("preset").preset;
const Slot = types.primitive.Slot.Type;
const Epoch = types.primitive.Epoch.Type;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const SLOTS_PER_HISTORICAL_ROOT = preset.SLOTS_PER_HISTORICAL_ROOT;
const computeStartSlotAtEpoch = @import("./epoch.zig").computeStartSlotAtEpoch;

pub fn getBlockRootAtSlot(comptime fork: ForkSeq, state: *BeaconState(fork), slot: Slot) !*const [32]u8 {
    const state_slot = try state.slot();
    if (slot >= state_slot) {
        return error.SlotTooBig;
    }

    const oldestStoredSlot = if (state_slot > SLOTS_PER_HISTORICAL_ROOT) state_slot - SLOTS_PER_HISTORICAL_ROOT else 0;

    if (slot < oldestStoredSlot) {
        return error.SlotTooSmall;
    }

    var block_roots = try state.blockRoots();
    return try block_roots.getFieldRoot(slot % SLOTS_PER_HISTORICAL_ROOT);
}

pub fn getBlockRoot(comptime fork: ForkSeq, state: *BeaconState(fork), epoch: Epoch) !*const [32]u8 {
    return getBlockRootAtSlot(fork, state, computeStartSlotAtEpoch(epoch));
}

// TODO: getTemporaryBlockHeader

// TODO: signedBlockToSignedHeader
