const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const isValidIndexedAttestation = @import("./is_valid_indexed_attestation.zig").isValidIndexedAttestation;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const Slot = types.primitive.Slot.Type;
const PendingAttestation = types.phase0.PendingAttestation.Type;

pub fn processAttestationPhase0(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(.phase0),
    attestation: *const ForkTypes(.phase0).Attestation.Type,
    verify_signature: bool,
) !void {
    const slot = try state.slot();
    const validators_count = try state.validatorsCount();

    const data = attestation.data;

    try validateAttestation(.phase0, epoch_cache, state, attestation);

    const pending_attestation = PendingAttestation{
        .data = data,
        .aggregation_bits = attestation.aggregation_bits,
        .inclusion_delay = slot - data.slot,
        .proposer_index = try epoch_cache.getBeaconProposer(slot),
    };

    var justified_checkpoint: types.phase0.Checkpoint.Type = undefined;
    var epoch_pending_attestations: *types.phase0.EpochAttestations.TreeView = undefined;
    if (data.target.epoch == epoch_cache.epoch) {
        try state.currentJustifiedCheckpoint(&justified_checkpoint);
        epoch_pending_attestations = try state.currentEpochPendingAttestations();
    } else {
        try state.previousJustifiedCheckpoint(&justified_checkpoint);
        epoch_pending_attestations = try state.previousEpochPendingAttestations();
    }

    if (!types.phase0.Checkpoint.equals(&data.source, &justified_checkpoint)) {
        return error.InvalidAttestationSourceNotEqualToJustifiedCheckpoint;
    }
    try epoch_pending_attestations.pushValue(&pending_attestation);

    var indexed_attestation: types.phase0.IndexedAttestation.Type = undefined;
    try epoch_cache.computeIndexedAttestationPhase0(allocator, attestation, &indexed_attestation);
    defer types.phase0.IndexedAttestation.deinit(allocator, &indexed_attestation);

    if (!try isValidIndexedAttestation(
        .phase0,
        allocator,
        io,
        config,
        epoch_cache,
        validators_count,
        &indexed_attestation,
        verify_signature,
    )) {
        return error.InvalidAttestationInvalidIndexedAttestation;
    }
}

/// AT could be either Phase0Attestation or ElectraAttestation
pub fn validateAttestation(
    comptime fork: ForkSeq,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    attestation: *const ForkTypes(fork).Attestation.Type,
) !void {
    const state_slot = try state.slot();
    const data = attestation.data;
    const computed_epoch = computeEpochAtSlot(data.slot);
    const committee_count = try epoch_cache.getCommitteeCountPerSlot(computed_epoch);
    if (data.target.epoch != epoch_cache.previous_shuffling.get().epoch and data.target.epoch != epoch_cache.epoch) {
        // TODO: print to stderr?
        return error.InvalidAttestationTargetEpochNotInPreviousOrCurrentEpoch;
    }

    if (data.target.epoch != computed_epoch) {
        return error.InvalidAttestationTargetEpochDoesNotMatchComputedEpoch;
    }

    // post deneb, the attestations are valid till end of next epoch
    if (!(data.slot + preset.MIN_ATTESTATION_INCLUSION_DELAY <= state_slot and isTimelyTarget(fork, state_slot - data.slot))) {
        return error.InvalidAttestationSlotNotWithInInclusionWindow;
    }

    if (fork.gte(.electra)) {
        if (comptime fork.lt(.gloas)) {
            if (data.index != 0) return error.InvalidAttestationNonZeroDataIndex;
        }
        var committee_indices_buffer: [preset.MAX_COMMITTEES_PER_SLOT]usize = undefined;
        const committee_indices_len = try attestation.committee_bits.getTrueBitIndexes(committee_indices_buffer[0..]);
        const committee_indices = committee_indices_buffer[0..committee_indices_len];
        if (committee_indices.len == 0) {
            return error.InvalidAttestationCommitteeBitsEmpty;
        }

        const last_committee_index = committee_indices[committee_indices.len - 1];

        if (last_committee_index >= committee_count) {
            return error.InvalidAttestationInvalidLstCommitteeIndex;
        }

        var aggregation_bits_buffer: [preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT]bool = undefined;
        if (attestation.aggregation_bits.bit_len > aggregation_bits_buffer.len) return error.InvalidAttestationAggregationBitsTooLong;
        var aggregation_bits_slice = aggregation_bits_buffer[0..attestation.aggregation_bits.bit_len];
        try attestation.aggregation_bits.toBoolSlice(&aggregation_bits_slice);
        const aggregation_bits_array = aggregation_bits_slice;
        // instead of implementing/calling getBeaconCommittees(slot, committee_indices.items), we call getBeaconCommittee(slot, index)
        var committee_offset: usize = 0;
        for (committee_indices) |committee_index| {
            const committee_validators = try epoch_cache.getBeaconCommittee(data.slot, committee_index);
            if (committee_offset + committee_validators.len > aggregation_bits_array.len) {
                return error.InvalidAttestationCommitteeAggregationBitsLengthTooShort;
            }
            const committee_aggregation_bits = aggregation_bits_array[committee_offset..(committee_offset + committee_validators.len)];

            // Assert aggregation bits in this committee have at least one true bit
            var all_false: bool = true;
            for (committee_aggregation_bits) |bit| {
                if (bit == true) {
                    all_false = false;
                    break;
                }
            }

            if (all_false) {
                return error.InvalidAttestationCommitteeAggregationBitsAllFalse;
            }
            committee_offset += committee_validators.len;
        }

        if (attestation.aggregation_bits.bit_len != committee_offset) {
            return error.InvalidAttestationCommitteeAggregationBitsLengthMismatch;
        }
    } else {
        // specific logic of phase to deneb
        if (!(data.index < committee_count)) {
            return error.InvalidAttestationInvalidCommitteeIndex;
        }

        const committee = try epoch_cache.getBeaconCommittee(data.slot, data.index);
        if (attestation.aggregation_bits.bit_len != committee.len) {
            return error.InvalidAttestationInvalidAggregationBitLen;
        }
    }
}

pub fn isTimelyTarget(comptime fork: ForkSeq, inclusion_distance: Slot) bool {
    // post deneb attestation is valid till end of next epoch for target
    if (fork.gte(.deneb)) {
        return true;
    }

    return inclusion_distance <= preset.SLOTS_PER_EPOCH;
}
