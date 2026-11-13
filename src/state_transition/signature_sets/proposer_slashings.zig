const std = @import("std");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const SingleSignatureSet = @import("../utils/signature_sets.zig").SingleSignatureSet;
const c = @import("constants");
const types = @import("consensus_types");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;

pub fn getProposerSlashingSignatureSets(
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    proposer_slashing: *const types.phase0.ProposerSlashing.Type,
) ![2]SingleSignatureSet {
    const signed_header_1 = proposer_slashing.signed_header_1;
    const signed_header_2 = proposer_slashing.signed_header_2;
    // In state transition, ProposerSlashing headers are only partially validated. Their slot could be higher than the
    // clock and the slashing would still be valid. Must use bigint variants to hash correctly to all possible values
    var result: [2]SingleSignatureSet = undefined;
    const domain_1 = try config.getDomain(epoch_cache.epoch, c.DOMAIN_BEACON_PROPOSER, signed_header_1.message.slot);
    const domain_2 = try config.getDomain(epoch_cache.epoch, c.DOMAIN_BEACON_PROPOSER, signed_header_2.message.slot);
    var signing_root_1: [32]u8 = undefined;
    try computeSigningRoot(types.phase0.BeaconBlockHeader, &signed_header_1.message, domain_1, &signing_root_1);
    var signing_root_2: [32]u8 = undefined;
    try computeSigningRoot(types.phase0.BeaconBlockHeader, &signed_header_2.message, domain_2, &signing_root_2);

    result[0] = SingleSignatureSet{
        .pubkey = epoch_cache.pubkey_cache.getPubkey(io, signed_header_1.message.proposer_index) orelse
            return error.PubkeyNotFound,
        .signing_root = signing_root_1,
        .signature = signed_header_1.signature,
    };

    result[1] = SingleSignatureSet{
        .pubkey = epoch_cache.pubkey_cache.getPubkey(io, signed_header_2.message.proposer_index) orelse
            return error.PubkeyNotFound,
        .signing_root = signing_root_2,
        .signature = signed_header_2.signature,
    };

    return result;
}

pub fn proposerSlashingsSignatureSets(
    comptime fork: ForkSeq,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    _: *const BeaconState(fork),
    signed_block: *const ForkTypes(fork).SignedBeaconBlock.Type,
    out: *std.ArrayList(SingleSignatureSet),
) !void {
    const proposer_slashings = signed_block.message.body.proposer_slashings.items;
    for (proposer_slashings) |*proposer_slashing| {
        const signature_sets = try getProposerSlashingSignatureSets(io, config, epoch_cache, proposer_slashing);
        try out.append(allocator, signature_sets[0]);
        try out.append(allocator, signature_sets[1]);
    }
}
