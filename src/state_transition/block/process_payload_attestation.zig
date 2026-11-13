const std = @import("std");
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const isValidIndexedPayloadAttestation = @import("./is_valid_indexed_payload_attestation.zig").isValidIndexedPayloadAttestation;
const getPayloadTimelinessCommittee = @import("../utils/gloas.zig").getPayloadTimelinessCommittee;
const preset = @import("preset").preset;

pub fn processPayloadAttestation(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    payload_attestation: *const ForkTypes(fork).PayloadAttestation.Type,
    verify_signature: bool,
) !void {
    const data = &payload_attestation.data;

    var latest_block_header = try state.latestBlockHeader();
    const parent_root = try latest_block_header.getFieldRoot("parent_root");
    if (!std.mem.eql(u8, &data.beacon_block_root, parent_root)) {
        return error.PayloadAttestationWrongBlock;
    }

    const state_slot = try state.slot();
    if (state_slot == 0 or data.slot != state_slot - 1) {
        return error.PayloadAttestationNotFromPreviousSlot;
    }

    var committee: ForkTypes(fork).PayloadTimelinessCommittee.Type = undefined;
    try getPayloadTimelinessCommittee(fork, config, state, data.slot, &committee);
    var indices_buf: [preset.PTC_SIZE]u64 = undefined;
    var indexed = ForkTypes(fork).IndexedPayloadAttestation.default_value;
    indexed.data = data.*;
    indexed.signature = payload_attestation.signature;
    indexed.attesting_indices = .initBuffer(&indices_buf);
    for (committee, 0..) |index, i| {
        if (try payload_attestation.aggregation_bits.get(i)) indexed.attesting_indices.appendAssumeCapacity(index);
    }
    std.mem.sort(u64, indexed.attesting_indices.items, {}, std.sort.asc(u64));
    if (!(try isValidIndexedPayloadAttestation(fork, io, config, epoch_cache, &indexed, verify_signature))) return error.InvalidPayloadAttestation;
}
