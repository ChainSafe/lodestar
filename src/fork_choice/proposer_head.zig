//! Spec "Proposer head and reorg helpers": `get_proposer_head` and the predicates it
//! combines. Fulu drops the `is_shuffling_stable` condition.

const std = @import("std");
const preset = @import("preset").preset;
const store_mod = @import("store.zig");
const head_mod = @import("head.zig");
const Store = store_mod.Store;
const ForkChoiceNode = store_mod.ForkChoiceNode;
const BlockIndex = store_mod.BlockIndex;
const NO_BLOCK = store_mod.NO_BLOCK;
const Slot = store_mod.Slot;
const Root = store_mod.Root;
const computeEpochAtSlot = store_mod.computeEpochAtSlot;

pub const Error = error{ UnknownBlock, UnknownParent, ProposerBoostNotWornOff };

/// Spec `get_proposer_head`: the node to build on at `slot`.
pub fn getProposerHead(store: *Store, head: ForkChoiceNode, slot: Slot) !ForkChoiceNode {
    try head_mod.ensureComputed(store);
    const slots = store.blocks.items(.slot);
    const parent = store.blocks.items(.parent)[head.block];
    if (parent == NO_BLOCK) return error.UnknownParent;
    const parent_node: ForkChoiceNode = .{ .block = parent, .payload_status = store.blocks.items(.parent_payload_status)[head.block] };

    const head_late = isHeadLate(store, head.block);
    const shuffling_stable = store.config.forkSeq(slot).gte(.fulu) or isShufflingStable(slot);
    const ffg_competitive = isFfgCompetitive(store, head.block, parent);
    const finalization_ok = isFinalizationOk(store, slot);
    const proposing_on_time = isProposingOnTime(store);
    const parent_slot_ok = slots[parent] + 1 == slots[head.block];
    const current_time_ok = slots[head.block] + 1 == slot;
    const single_slot_reorg = parent_slot_ok and current_time_ok;
    if (std.mem.eql(u8, &store.proposer_boost_root, &store.blockRoot(head.block))) return error.ProposerBoostNotWornOff;
    const head_weak = try head_mod.isHeadWeak(store, head.block);
    const parent_strong = head_mod.isParentStrong(store, head.block);
    const proposer_equivocation = isProposerEquivocation(store, head.block);

    if (head_late and shuffling_stable and ffg_competitive and finalization_ok and proposing_on_time and single_slot_reorg and head_weak and parent_strong) {
        return parent_node;
    }
    if (head_weak and current_time_ok and proposer_equivocation) return parent_node;
    return head;
}

/// Spec `is_head_late`.
pub fn isHeadLate(store: *const Store, block: BlockIndex) bool {
    return !store.blocks.items(.timely)[block][store_mod.ATTESTATION_TIMELINESS_INDEX];
}

/// Spec `is_shuffling_stable`.
pub fn isShufflingStable(slot: Slot) bool {
    return slot % preset.SLOTS_PER_EPOCH != 0;
}

/// Spec `is_ffg_competitive`.
pub fn isFfgCompetitive(store: *const Store, block: BlockIndex, parent: BlockIndex) bool {
    const unrealized = store.blocks.items(.unrealized_justified_checkpoint);
    return store_mod.checkpointEql(unrealized[block], unrealized[parent]);
}

/// Spec `is_finalization_ok`.
pub fn isFinalizationOk(store: *const Store, slot: Slot) bool {
    const epochs_since_finalization = computeEpochAtSlot(slot) - store.finalized_checkpoint.epoch;
    return epochs_since_finalization <= store.config.chain.REORG_MAX_EPOCHS_SINCE_FINALIZATION;
}

/// Spec `is_proposing_on_time`.
pub fn isProposingOnTime(store: *const Store) bool {
    return store.timeIntoSlotMs() <= store.proposerReorgCutoffMs();
}

/// Spec `is_proposer_equivocation`.
pub fn isProposerEquivocation(store: *const Store, block: BlockIndex) bool {
    const slots = store.blocks.items(.slot);
    const proposers = store.blocks.items(.proposer_index);
    var matching: usize = 0;
    for (slots, proposers) |slot, proposer| {
        if (slot == slots[block] and proposer == proposers[block]) matching += 1;
    }
    return matching > 1;
}
