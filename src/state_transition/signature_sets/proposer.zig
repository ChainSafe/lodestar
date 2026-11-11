const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const SingleSignatureSet = @import("../utils/signature_sets.zig").SingleSignatureSet;
const c = @import("constants");
const types = @import("consensus_types");
const Root = types.primitive.Root;
const computeSigningRootFromObjectRoot = @import("../utils/signing_root.zig").computeSigningRootFromObjectRoot;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const verifySignatureSet = @import("../utils/signature_sets.zig").verifySingleSignatureSet;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;

/// `transactions_root` is the root of the block's execution payload transactions when the caller knows it.
/// For a full block whose body carries a payload it is set on return, so the caller can reuse it
/// instead of merkleizing the transactions again.
pub fn verifyProposerSignature(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    signed_block: AnySignedBeaconBlock,
    transactions_root: *?[32]u8,
) !bool {
    const signature_set = try getBlockProposerSignatureSet(
        allocator,
        io,
        config,
        epoch_cache,
        signed_block,
        transactions_root,
    );
    return try verifySignatureSet(&signature_set);
}

/// See `verifyProposerSignature` for `transactions_root`.
pub fn getBlockProposerSignatureSet(
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    signed_block: AnySignedBeaconBlock,
    transactions_root: *?[32]u8,
) !SingleSignatureSet {
    const block = signed_block.beaconBlock();
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_BEACON_PROPOSER, block.slot());
    const block_roots = try block.roots(allocator, if (transactions_root.*) |*known_root| known_root else null);
    if (block_roots.transactions) |root| transactions_root.* = root;
    var signing_root_buf: [32]u8 = undefined;
    try computeSigningRootFromObjectRoot(&block_roots.block, domain, &signing_root_buf);

    // The proposer index isn't validated until processBlockHeader, so a malicious block could
    // put an out-of-range value here.
    const proposer_index = block.proposerIndex();
    const pubkey = epoch_cache.pubkey_cache.getPubkey(io, proposer_index) orelse
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
    signed_block_header: *const types.phase0.SignedBeaconBlockHeader.Type,
) !SingleSignatureSet {
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_BEACON_PROPOSER, signed_block_header.message.slot);
    var signing_root: Root = undefined;
    try computeSigningRoot(types.phase0.SignedBeaconBlockHeader, signed_block_header, domain, &signing_root);

    return .{
        .pubkey = epoch_cache.pubkey_cache.getPubkey(io, signed_block_header.message.proposer_index) orelse
            return error.PubkeyNotFound,
        .signing_root = signing_root,
        .signature = signed_block_header.signature,
    };
}
