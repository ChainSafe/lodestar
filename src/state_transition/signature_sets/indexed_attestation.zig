const std = @import("std");
const Allocator = std.mem.Allocator;
const bls = @import("bls");
const PublicKey = bls.PublicKey;
const types = @import("consensus_types");
const Epoch = types.primitive.Epoch.Type;
const AttestationData = types.phase0.AttestationData.Type;
const BLSSignature = types.primitive.BLSSignature.Type;
const Root = types.primitive.Root.Type;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ForkTypes = @import("fork_types").ForkTypes;
const c = @import("constants");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const computeStartSlotAtEpoch = @import("../utils/epoch.zig").computeStartSlotAtEpoch;
const AggregatedSignatureSet = @import("../utils/signature_sets.zig").AggregatedSignatureSet;
const createAggregateSignatureSetFromComponents = @import("../utils/signature_sets.zig").createAggregateSignatureSetFromComponents;

pub fn getAttestationDataSigningRoot(config: *const BeaconConfig, state_epoch: Epoch, data: *const AttestationData, out: *[32]u8) !void {
    const slot = computeStartSlotAtEpoch(data.target.epoch);
    const domain = try config.getDomain(state_epoch, c.DOMAIN_BEACON_ATTESTER, slot);

    try computeSigningRoot(types.phase0.AttestationData, data, domain, out);
}

/// Consumer need to free the returned pubkeys array
pub fn getAttestationWithIndicesSignatureSet(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    data: *const AttestationData,
    signature: BLSSignature,
    attesting_indices: []u64,
) !AggregatedSignatureSet {
    const pubkeys = try allocator.alloc(PublicKey, attesting_indices.len);
    errdefer allocator.free(pubkeys);
    epoch_cache.pubkey_cache.getPubkeys(io, attesting_indices, pubkeys) catch |err| switch (err) {
        error.InvalidIndex => return error.PubkeyNotFound,
        else => return err,
    };

    var signing_root: Root = undefined;
    try getAttestationDataSigningRoot(config, epoch_cache.epoch, data, &signing_root);

    return createAggregateSignatureSetFromComponents(pubkeys, signing_root, signature);
}

/// Consumer need to free the returned pubkeys array
pub fn getIndexedAttestationSignatureSet(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    indexed_attestation: *const ForkTypes(fork).IndexedAttestation.Type,
) !AggregatedSignatureSet {
    return try getAttestationWithIndicesSignatureSet(
        allocator,
        io,
        config,
        epoch_cache,
        &indexed_attestation.data,
        indexed_attestation.signature,
        indexed_attestation.attesting_indices.items,
    );
}
