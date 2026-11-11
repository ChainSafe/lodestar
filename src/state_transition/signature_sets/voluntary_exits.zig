const std = @import("std");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const SingleSignatureSet = @import("../utils/signature_sets.zig").SingleSignatureSet;
const types = @import("consensus_types");
const SignedVoluntaryExit = types.phase0.SignedVoluntaryExit.Type;
const computeStartSlotAtEpoch = @import("../utils/epoch.zig").computeStartSlotAtEpoch;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const verifySingleSignatureSet = @import("../utils/signature_sets.zig").verifySingleSignatureSet;

pub fn verifyVoluntaryExitSignature(
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    signed_voluntary_exit: *const SignedVoluntaryExit,
) !bool {
    const signature_set = try getVoluntaryExitSignatureSet(
        io,
        config,
        epoch_cache,
        signed_voluntary_exit,
    );
    return try verifySingleSignatureSet(&signature_set);
}

pub fn getVoluntaryExitSignatureSet(
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    signed_voluntary_exit: *const SignedVoluntaryExit,
) !SingleSignatureSet {
    const slot = computeStartSlotAtEpoch(signed_voluntary_exit.message.epoch);
    const domain = try config.getDomainForVoluntaryExit(epoch_cache.epoch, slot);
    var signing_root: [32]u8 = undefined;
    try computeSigningRoot(types.phase0.VoluntaryExit, &signed_voluntary_exit.message, domain, &signing_root);

    return .{
        .pubkey = epoch_cache.pubkey_cache.getPubkey(io, signed_voluntary_exit.message.validator_index) orelse
            return error.PubkeyNotFound,
        .signing_root = signing_root,
        .signature = signed_voluntary_exit.signature,
    };
}

pub fn voluntaryExitsSignatureSets(
    allocator: std.mem.Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    voluntary_exits: []types.phase0.SignedVoluntaryExit.Type,
    out: *std.ArrayList(SingleSignatureSet),
) !void {
    for (voluntary_exits) |*signed_voluntary_exit| {
        const signature_set = try getVoluntaryExitSignatureSet(
            io,
            config,
            epoch_cache,
            signed_voluntary_exit,
        );
        try out.append(allocator, signature_set);
    }
}
