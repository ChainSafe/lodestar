const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const SingleSignatureSet = @import("../utils/signature_sets.zig").SingleSignatureSet;
const c = @import("constants");
const types = @import("consensus_types");
const Root = types.primitive.Root;
const computeBlockSigningRoot = @import("../utils/signing_root.zig").computeBlockSigningRoot;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const verifySignatureSet = @import("../utils/signature_sets.zig").verifySingleSignatureSet;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;

pub fn verifyProposerSignature(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    validators: anytype,
    signed_block: AnySignedBeaconBlock,
) !bool {
    const signature_set = try getBlockProposerSignatureSet(
        allocator,
        io,
        config,
        epoch_cache,
        validators,
        signed_block,
    );
    return try verifySignatureSet(&signature_set);
}

pub fn getBlockProposerSignatureSet(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    validators: anytype,
    signed_block: AnySignedBeaconBlock,
) !SingleSignatureSet {
    const block = signed_block.beaconBlock();
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_BEACON_PROPOSER, block.slot());
    // var signing_root: Root = undefined;
    var signing_root_buf: [32]u8 = undefined;
    try computeBlockSigningRoot(allocator, block, domain, &signing_root_buf);

    // Root.uncompressFromBytes(&signing_root_buf, &signing_root);

    // The proposer index isn't validated until processBlockHeader, so a malicious block could
    // put an out-of-range value here.
    const proposer_index = block.proposerIndex();
    const pubkey = (try epoch_cache.pubkey_cache.getPubkeyForState(io, proposer_index, validators)) orelse
        return error.InvalidProposerIndex;

    return .{
        .pubkey = pubkey,
        .signing_root = signing_root_buf,
        .signature = signed_block.signature().*,
    };
}

pub fn getBlockHeaderProposerSignatureSet(
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    validators: anytype,
    signed_block_header: *const types.phase0.SignedBeaconBlockHeader.Type,
) !SingleSignatureSet {
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_BEACON_PROPOSER, signed_block_header.message.slot);
    var signing_root: Root = undefined;
    try computeSigningRoot(types.phase0.SignedBeaconBlockHeader, signed_block_header, domain, &signing_root);

    return .{
        .pubkey = (try epoch_cache.pubkey_cache.getPubkeyForState(io, signed_block_header.message.proposer_index, validators)) orelse
            return error.PubkeyNotFound,
        .signing_root = signing_root,
        .signature = signed_block_header.signature,
    };
}
