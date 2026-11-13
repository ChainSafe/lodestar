const std = @import("std");
const types = @import("consensus_types");
const Slot = types.primitive.Slot.Type;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const Root = types.primitive.Root.Type;
const SingleSignatureSet = @import("../utils/signature_sets.zig").SingleSignatureSet;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const c = @import("constants");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const verifySingleSignatureSet = @import("../utils/signature_sets.zig").verifySingleSignatureSet;

pub fn verifyRandaoSignature(
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    randao_reveal: *const [96]u8,
    slot: Slot,
    proposer_idx: u64,
) !bool {
    const signature_set = try randaoRevealSignatureSet(io, config, epoch_cache, randao_reveal, slot, proposer_idx);
    return verifySingleSignatureSet(&signature_set);
}

pub fn randaoRevealSignatureSet(
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    randao_reveal: *const [96]u8,
    slot: Slot,
    proposer_idx: u64,
) !SingleSignatureSet {
    // should not get epoch from epoch_cache
    const epoch = computeEpochAtSlot(slot);
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_RANDAO, slot);
    var signing_root: Root = undefined;
    try computeSigningRoot(types.primitive.Epoch, &epoch, domain, &signing_root);
    return .{
        .pubkey = epoch_cache.pubkey_cache.getPubkey(io, proposer_idx) orelse
            return error.PubkeyNotFound,
        .signing_root = signing_root,
        .signature = randao_reveal.*,
    };
}
