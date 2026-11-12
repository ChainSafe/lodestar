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

/// Why `get_proposer_head` keeps the head, in the order a client reports them.
pub const KeepReason = enum {
    head_timely,
    shuffling_not_stable,
    not_ffg_competitive,
    finalization_not_ok,
    parent_not_previous_slot,
    not_proposing_on_time,
    not_proposing_next_slot,
    proposer_boost_not_worn_off,
    head_not_weak,
    parent_not_strong,
};

pub const Decision = union(enum) {
    /// Build on the parent node: the head is reorged out.
    reorg: ForkChoiceNode,
    keep: KeepReason,
};

/// Spec `get_proposer_head`: the node to build on at `slot`.
pub fn getProposerHead(store: *Store, head: ForkChoiceNode, slot: Slot) !ForkChoiceNode {
    if (std.mem.eql(u8, &store.proposer_boost_root, &store.blockRoot(head.block))) return error.ProposerBoostNotWornOff;
    return switch (try decide(store, head, slot)) {
        .reorg => |parent_node| parent_node,
        .keep => head,
    };
}

/// `get_proposer_head` with the first condition that keeps the head. Where the spec
/// asserts the proposer boost has worn off, this reports it as a reason like the others.
pub fn decide(store: *Store, head: ForkChoiceNode, slot: Slot) !Decision {
    const computed = try head_mod.ensureComputed(store);
    const slots = store.blocks.items(.slot);
    const parent = store.blocks.items(.parent)[head.block];
    if (parent == NO_BLOCK) return error.UnknownParent;
    const parent_node: ForkChoiceNode = .{ .block = parent, .payload_status = store.blocks.items(.parent_payload_status)[head.block] };

    const current_time_ok = slots[head.block] + 1 == slot;
    const boost_worn_off = !std.mem.eql(u8, &store.proposer_boost_root, &store.blockRoot(head.block));
    if (current_time_ok and boost_worn_off and isProposerEquivocation(store, head.block) and try computed.isHeadWeak(head.block)) {
        return .{ .reorg = parent_node };
    }

    if (!isHeadLate(store, head.block)) return .{ .keep = .head_timely };
    if (!(store.config.forkSeq(slot).gte(.fulu) or isShufflingStable(slot))) return .{ .keep = .shuffling_not_stable };
    if (!isFfgCompetitive(store, head.block, parent)) return .{ .keep = .not_ffg_competitive };
    if (!isFinalizationOk(store, slot)) return .{ .keep = .finalization_not_ok };
    if (slots[parent] + 1 != slots[head.block]) return .{ .keep = .parent_not_previous_slot };
    if (!isProposingOnTime(store)) return .{ .keep = .not_proposing_on_time };
    if (!current_time_ok) return .{ .keep = .not_proposing_next_slot };
    if (!boost_worn_off) return .{ .keep = .proposer_boost_not_worn_off };
    if (!try computed.isHeadWeak(head.block)) return .{ .keep = .head_not_weak };
    if (!computed.isParentStrong(head.block)) return .{ .keep = .parent_not_strong };
    return .{ .reorg = parent_node };
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
