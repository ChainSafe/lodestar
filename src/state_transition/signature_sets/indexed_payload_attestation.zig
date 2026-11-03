const std = @import("std");
const ForkTypes = @import("fork_types").ForkTypes;
const bls = @import("bls");
const PublicKey = bls.PublicKey;
const types = @import("consensus_types");
const Root = types.primitive.Root.Type;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const c = @import("constants");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const AggregatedSignatureSet = @import("../utils/signature_sets.zig").AggregatedSignatureSet;
const createAggregateSignatureSetFromComponents = @import("../utils/signature_sets.zig").createAggregateSignatureSetFromComponents;

pub fn getPayloadAttestationDataSigningRoot(comptime fork: ForkSeq, config: *const BeaconConfig, data: *const ForkTypes(fork).PayloadAttestationData.Type, out: *[32]u8) !void {
    const domain = try config.getDomain(computeEpochAtSlot(data.slot), c.DOMAIN_PTC_ATTESTER, null);

    try computeSigningRoot(ForkTypes(fork).PayloadAttestationData, data, domain, out);
}

/// The returned set borrows `pubkeys`, which must remain alive through verification.
/// `pubkeys` must have one entry per attesting index.
pub fn getIndexedPayloadAttestationSignatureSet(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    indexed_payload_attestation: *const ForkTypes(fork).IndexedPayloadAttestation.Type,
    pubkeys: []PublicKey,
) !AggregatedSignatureSet {
    const attesting_indices = indexed_payload_attestation.attesting_indices.items;

    epoch_cache.pubkey_cache.getPubkeys(io, attesting_indices, pubkeys) catch |err| switch (err) {
        error.InvalidIndex => return error.PubkeyNotFound,
        else => return err,
    };

    var signing_root: Root = undefined;
    try getPayloadAttestationDataSigningRoot(fork, config, &indexed_payload_attestation.data, &signing_root);

    return createAggregateSignatureSetFromComponents(pubkeys, signing_root, indexed_payload_attestation.signature);
}
