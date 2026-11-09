const std = @import("std");
const bls = @import("bls");
const ForkTypes = @import("fork_types").ForkTypes;
const types = @import("consensus_types");
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const getIndexedPayloadAttestationSignatureSet = @import("../signature_sets/indexed_payload_attestation.zig").getIndexedPayloadAttestationSignatureSet;
const verifyAggregatedSignatureSet = @import("../utils/signature_sets.zig").verifyAggregatedSignatureSet;
const preset = @import("preset").preset;

/// The indices must obey the SSZ bound of `PTC_SIZE`.
pub fn isValidIndexedPayloadAttestation(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    indexed_payload_attestation: *const ForkTypes(fork).IndexedPayloadAttestation.Type,
    verify_signature: bool,
) !bool {
    const attesting_indices = indexed_payload_attestation.attesting_indices.items;

    std.debug.assert(attesting_indices.len <= preset.PTC_SIZE);
    if (attesting_indices.len == 0) return false;

    var prev: ValidatorIndex = 0;
    for (attesting_indices, 0..) |index, i| {
        if (i >= 1 and index < prev) {
            return false;
        }
        prev = index;
    }

    if (!verify_signature) return true;

    var pubkeys_buf: [preset.PTC_SIZE]bls.PublicKey = undefined;
    const sig_set = try getIndexedPayloadAttestationSignatureSet(fork, io, config, epoch_cache, indexed_payload_attestation, pubkeys_buf[0..attesting_indices.len]);
    return verifyAggregatedSignatureSet(&sig_set);
}
