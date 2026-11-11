const std = @import("std");
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const verifyAggregatedSignatureSet = @import("../utils/signature_sets.zig").verifyAggregatedSignatureSet;
const getIndexedAttestationSignatureSet = @import("../signature_sets/indexed_attestation.zig").getIndexedAttestationSignatureSet;

pub fn isValidIndexedAttestation(
    comptime fork: ForkSeq,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    validators_count: usize,
    indexed_attestation: *const ForkTypes(fork).IndexedAttestation.Type,
    verify_signature: bool,
) !bool {
    if (!(try isValidIndexedAttestationIndices(fork, validators_count, indexed_attestation.attesting_indices.items))) {
        return false;
    }

    if (verify_signature) {
        const signature_set = try getIndexedAttestationSignatureSet(
            fork,
            allocator,
            io,
            config,
            epoch_cache,
            indexed_attestation,
        );
        defer allocator.free(signature_set.pubkeys);
        return try verifyAggregatedSignatureSet(&signature_set);
    } else {
        return true;
    }
}

pub fn isValidIndexedAttestationIndices(
    comptime fork: ForkSeq,
    validators_count: usize,
    indices: []const ValidatorIndex,
) !bool {
    // verify max number of indices
    const max_indices: usize = if (fork.gte(.electra))
        preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT
    else
        preset.MAX_VALIDATORS_PER_COMMITTEE;

    if (!(indices.len > 0 and indices.len <= max_indices)) {
        return false;
    }

    // verify indices are sorted and unique.
    // Just check if they are monotonically increasing,
    // instead of creating a set and sorting it. Should be (O(n)) instead of O(n log(n))
    var prev: ValidatorIndex = 0;
    for (indices, 0..) |index, i| {
        if (i >= 1 and index <= prev) {
            return false;
        }
        prev = index;
    }

    // check if indices are out of bounds, by checking the highest index (since it is sorted).
    // After the uniqueness loop above, prev already holds the last (highest) index.
    // indices.len > 0 is guaranteed by the first check.
    if (prev >= validators_count) {
        return false;
    }

    return true;
}
