const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ProposerRewards = @import("../cache/state_cache.zig").ProposerRewards;
const BeaconState = @import("fork_types").BeaconState;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const AggregatedSignatureSet = @import("../utils/signature_sets.zig").AggregatedSignatureSet;
const types = @import("consensus_types");
const SyncAggregate = types.altair.SyncAggregate.Type;
const preset = @import("preset").preset;
const Root = types.primitive.Root.Type;
const G2_POINT_AT_INFINITY = @import("constants").G2_POINT_AT_INFINITY;
const c = @import("constants");
const bls = @import("bls");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const verifyAggregatedSignatureSet = @import("../utils/signature_sets.zig").verifyAggregatedSignatureSet;
const getBeaconProposer = @import("../cache/get_beacon_proposer.zig").getBeaconProposer;
const balance_utils = @import("../utils/balance.zig");
const getBlockRootAtSlot = @import("../utils/block_root.zig").getBlockRootAtSlot;
const Node = @import("persistent_merkle_tree").Node;
const increaseBalance = balance_utils.increaseBalance;
const decreaseBalance = balance_utils.decreaseBalance;

pub fn processSyncAggregate(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    proposer_rewards: *ProposerRewards,
    sync_aggregate: *const SyncAggregate,
    verify_signatures: bool,
) !void {
    const committee_indices = @as(*const [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex, @ptrCast(try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices()));
    const sync_committee_bits = sync_aggregate.sync_committee_bits;
    const signature = sync_aggregate.sync_committee_signature;

    // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
    if (verify_signatures) {
        var participant_buf: [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex = undefined;
        const participant_indices = sync_committee_bits.intersectValues(
            ValidatorIndex,
            committee_indices,
            &participant_buf,
        );

        // When there's no participation we cons ider the signature valid and just ignore it
        if (participant_indices.len > 0) {
            const previous_slot = @max(try state.slot(), 1) - 1;
            const root_signed = try getBlockRootAtSlot(fork, state, previous_slot);
            const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_SYNC_COMMITTEE, previous_slot);

            var pubkeys_buf: [preset.SYNC_COMMITTEE_SIZE]bls.PublicKey = undefined;
            const pubkeys = pubkeys_buf[0..participant_indices.len];
            epoch_cache.pubkey_cache.getPubkeys(io, participant_indices, pubkeys) catch |err| switch (err) {
                error.InvalidIndex => return error.PubkeyNotFound,
                else => return err,
            };

            var signing_root: Root = undefined;
            try computeSigningRoot(types.primitive.Root, root_signed, domain, &signing_root);

            const signature_set = AggregatedSignatureSet{
                .pubkeys = pubkeys,
                .signing_root = signing_root,
                .signature = signature,
            };

            if (!try verifyAggregatedSignatureSet(&signature_set)) {
                return error.SyncCommitteeSignatureInvalid;
            }
        } else {
            if (!std.mem.eql(u8, &signature, &c.G2_POINT_AT_INFINITY)) {
                return error.EmptySyncCommitteeSignatureIsNotInfinity;
            }
        }
    }

    const sync_participant_reward = epoch_cache.sync_participant_reward;
    const sync_proposer_reward = epoch_cache.sync_proposer_reward;
    const proposer_index = try getBeaconProposer(fork, epoch_cache, state, try state.slot());
    var balances = try state.balances();
    var proposer_balance = try balances.get(proposer_index);

    for (0..preset.SYNC_COMMITTEE_SIZE) |i| {
        const index = committee_indices[i];

        if (try sync_committee_bits.get(i)) {
            // Positive rewards for participants
            if (index == proposer_index) {
                proposer_balance += sync_participant_reward;
            } else {
                try increaseBalance(fork, state, index, sync_participant_reward);
            }

            // Proposer reward
            proposer_balance += sync_proposer_reward;
            proposer_rewards.sync_aggregate += sync_proposer_reward;
        } else {
            // Negative rewards for non participants
            if (index == proposer_index) {
                proposer_balance = proposer_balance -| sync_participant_reward;
            } else {
                try decreaseBalance(fork, state, index, sync_participant_reward);
            }
        }
    }

    // Apply proposer balance
    try balances.set(proposer_index, proposer_balance);
}

/// Consumers should deinit the returned pubkeys
/// this is to be used when we implement getBlockSignatureSets
pub fn getSyncCommitteeSignatureSet(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    sync_aggregate: *const SyncAggregate,
    block_slot: u64,
    block_parent_root: *const Root,
    participant_indices: ?[]const ValidatorIndex,
) !?AggregatedSignatureSet {
    const signature = sync_aggregate.sync_committee_signature;

    var participant_buf: [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex = undefined;
    const participant_indices_: []const ValidatorIndex = if (participant_indices) |indices|
        indices
    else blk: {
        const committee_indices = @as(*const [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex, @ptrCast(try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices()));
        break :blk sync_aggregate.sync_committee_bits.intersectValues(ValidatorIndex, committee_indices, &participant_buf);
    };
    // When there's no participation we consider the signature valid and just ignore it
    if (participant_indices_.len == 0) {
        // Must set signature as G2_POINT_AT_INFINITY when participating bits are empty
        // https://github.com/ethereum/eth2.0-specs/blob/30f2a076377264677e27324a8c3c78c590ae5e20/specs/altair/bls.md#eth2_fast_aggregate_verify
        if (std.mem.eql(u8, &signature, &G2_POINT_AT_INFINITY)) {
            return null;
        }
        return error.EmptySyncCommitteeSignatureIsNotInfinity;
    }

    // The spec uses the state to get the previous slot
    // ```python
    // previous_slot = max(state.slot, Slot(1)) - Slot(1)
    // ```
    // However we need to run the function getSyncCommitteeSignatureSet() for all the blocks in a epoch
    // with the same state when verifying blocks in batch on RangeSync. Therefore we use the block.slot.
    const previous_slot = block_slot -| 1;

    // The spec uses the state to get the root at previousSlot
    // ```python
    // get_block_root_at_slot(state, previous_slot)
    // ```
    // However we need to run the function getSyncCommitteeSignatureSet() for all the blocks in a epoch
    // with the same state when verifying blocks in batch on RangeSync.
    //
    // On skipped slots state block roots just copy the latest block, so using the parentRoot here is equivalent.
    // So getSyncCommitteeSignatureSet() can be called with a state in any slot (with the correct shuffling)
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_SYNC_COMMITTEE, previous_slot);

    const pubkeys = try allocator.alloc(bls.PublicKey, participant_indices_.len);
    errdefer allocator.free(pubkeys);
    epoch_cache.pubkey_cache.getPubkeys(io, participant_indices_, pubkeys) catch |err| switch (err) {
        error.InvalidIndex => return error.PubkeyNotFound,
        else => return err,
    };
    var signing_root: Root = undefined;
    try computeSigningRoot(types.primitive.Root, block_parent_root, domain, &signing_root);

    return .{
        .pubkeys = pubkeys,
        .signing_root = signing_root,
        .signature = signature,
    };
}

test {
    _ = @import("process_sync_committee_test.zig");
}
