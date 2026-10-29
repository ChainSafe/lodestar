const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const BLSSignature = types.primitive.BLSSignature.Type;
const Sha256 = std.crypto.hash.sha2.Sha256;
const ZERO_BIGINT = 0;

pub fn isSyncCommitteeAggregator(selection_proof: BLSSignature) bool {
    const module = @max(1, @divFloor(@divFloor(preset.SYNC_COMMITTEE_SIZE, c.SYNC_COMMITTEE_SUBNET_COUNT), c.TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE));
    return isSelectionProofValid(selection_proof, module);
}

pub fn isAggregatorFromCommitteeLength(committee_len: usize, slot_signature: BLSSignature) bool {
    const module = @max(1, @divFloor(committee_len, c.TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE));
    return isSelectionProofValid(slot_signature, module);
}

pub fn isSelectionProofValid(sig: BLSSignature, modulo: u64) bool {
    var root: [32]u8 = undefined;
    Sha256.hash(sig.toBytes(), &root, .{});
    const value = std.mem.readInt(u64, root[0..8], .little);
    return (value % modulo) == ZERO_BIGINT;
}
