const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const ssz = @import("ssz");
const Slot = types.primitive.Slot.Type;
const preset = @import("preset").preset;
const state_transition = @import("../root.zig");
const CachedBeaconState = state_transition.CachedBeaconState;
const computeStartSlotAtEpoch = state_transition.computeStartSlotAtEpoch;
const getBlockRootAtSlot = state_transition.getBlockRootAtSlot;
const BeaconState = @import("fork_types").BeaconState;

/// Generate a valid electra block for the given pre-state.
pub fn generateElectraBlock(allocator: Allocator, cached_state: *CachedBeaconState, out: *types.electra.SignedBeaconBlock.Type) !void {
    const state = cached_state.state;
    const fork_state = try state.tryCastToFork(.electra);
    var attestations = types.electra.Attestations.default_value;
    // no need to fill up to MAX_ATTESTATIONS_ELECTRA
    const att_slot: Slot = (try state.slot()) - 2;
    const att_index = 0;
    const att_block_root = try getBlockRootAtSlot(.electra, fork_state, att_slot);
    const target_epoch = cached_state.epoch_cache.epoch;
    const target_epoch_slot = computeStartSlotAtEpoch(target_epoch);
    var source_checkpoint: types.phase0.Checkpoint.Type = undefined;
    try state.currentJustifiedCheckpoint(&source_checkpoint);

    const att_target_root = try getBlockRootAtSlot(.electra, fork_state, target_epoch_slot);
    const att_data: types.phase0.AttestationData.Type = .{
        .slot = att_slot,
        .index = att_index,
        .beacon_block_root = att_block_root.*,
        .source = source_checkpoint,
        .target = .{
            .epoch = target_epoch,
            .root = att_target_root.*,
        },
    };
    const committee_count = try cached_state.epoch_cache.getCommitteeCountPerSlot(target_epoch);
    var total_committee_size: usize = 0;
    for (0..committee_count) |committee_index| {
        const committee = try cached_state.epoch_cache.getBeaconCommittee(att_slot, committee_index);
        total_committee_size += committee.len;
    }

    var aggregation_bits = try ssz.BitListType(preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT).Type.fromBitLen(allocator, total_committee_size);
    // TODO: why this does not work
    // var aggregation_bits = @field(types.electra.Attestation.Fields, "aggregation_bits").Type.fromBitLen(allocator, total_committee_size);
    for (0..total_committee_size) |i| {
        try aggregation_bits.set(allocator, i, true);
    }

    var committee_bits = ssz.BitVectorType(preset.MAX_COMMITTEES_PER_SLOT).default_value;
    // var committee_bits = @field(types.electra.Attestation.Fields, "committee_bits").default_value;
    for (0..committee_count) |i| {
        try committee_bits.set(i, true);
    }

    try attestations.append(allocator, .{
        .aggregation_bits = aggregation_bits,
        .data = att_data,
        .signature = types.primitive.BLSSignature.default_value,
        .committee_bits = committee_bits,
    });

    const block_slot = (try state.slot()) + 1;
    var latest_header = try state.latestBlockHeader();
    const parent_root = try latest_header.hashTreeRoot();

    var execution_payload = types.electra.ExecutionPayload.default_value;
    execution_payload.timestamp = (try state.genesisTime()) +
        block_slot * cached_state.config.chain.SECONDS_PER_SLOT;

    out.* = .{
        .message = .{
            .slot = block_slot,
            .proposer_index = try cached_state.epoch_cache.getBeaconProposer(block_slot),
            .parent_root = parent_root.*,
            // this could be computed later
            .state_root = [_]u8{0} ** 32,
            .body = .{
                .randao_reveal = [_]u8{0} ** 96,
                .eth1_data = types.phase0.Eth1Data.default_value,
                .graffiti = [_]u8{0} ** 32,
                // TODO: populate data to test other operations
                .proposer_slashings = types.phase0.ProposerSlashings.default_value,
                .attester_slashings = types.phase0.AttesterSlashings.default_value,
                .attestations = attestations,
                .deposits = types.phase0.Deposits.default_value,
                .voluntary_exits = types.phase0.VoluntaryExits.default_value,
                .sync_aggregate = .{
                    .sync_committee_bits = ssz.BitVectorType(preset.SYNC_COMMITTEE_SIZE).default_value,
                    .sync_committee_signature = types.primitive.BLSSignature.default_value,
                },
                .execution_payload = execution_payload,
                .bls_to_execution_changes = types.capella.SignedBLSToExecutionChanges.default_value,
                .blob_kzg_commitments = types.electra.BlobKzgCommitments.default_value,
                .execution_requests = types.electra.ExecutionRequests.default_value,
            },
        },
        .signature = types.primitive.BLSSignature.default_value,
    };
}
