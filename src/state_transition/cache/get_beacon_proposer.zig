const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;

pub fn getBeaconProposer(comptime fork: ForkSeq, epoch_cache: *const EpochCache, state: *BeaconState(fork), slot: u64) !u64 {
    const preset_import = @import("preset").preset;
    const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;

    // For Fulu, use proposer_lookahead from state
    if (comptime fork.gte(.fulu)) {
        const current_epoch = computeEpochAtSlot(try state.slot());
        const slot_epoch = computeEpochAtSlot(slot);

        // proposer_lookahead covers current_epoch through current_epoch + MIN_SEED_LOOKAHEAD
        const lookahead_start_epoch = current_epoch;
        const lookahead_end_epoch = current_epoch + preset_import.MIN_SEED_LOOKAHEAD;

        if (slot_epoch < lookahead_start_epoch or slot_epoch > lookahead_end_epoch) {
            return error.SlotOutsideProposerLookahead;
        }

        var proposer_lookahead = try state.proposerLookahead();
        const epoch_offset = slot_epoch - lookahead_start_epoch;
        const slot_in_epoch = slot % preset_import.SLOTS_PER_EPOCH;
        const index = epoch_offset * preset_import.SLOTS_PER_EPOCH + slot_in_epoch;

        return try proposer_lookahead.get(index);
    }
    return epoch_cache.getBeaconProposer(slot);
}
