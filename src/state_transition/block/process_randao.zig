const std = @import("std");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;
const BlockType = @import("fork_types").BlockType;
const BeaconBlockBody = @import("fork_types").BeaconBlockBody;
const getRandaoMix = @import("../utils/seed.zig").getRandaoMix;
const verifyRandaoSignature = @import("../signature_sets/randao.zig").verifyRandaoSignature;
const Sha256 = std.crypto.hash.sha2.Sha256;

pub fn processRandao(
    comptime fork: ForkSeq,
    io: std.Io,
    beacon_config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    comptime block_type: BlockType,
    body: *const BeaconBlockBody(block_type, fork),
    proposer_idx: u64,
    verify_signature: bool,
) !void {
    const epoch = epoch_cache.epoch;
    const randao_reveal = body.randaoReveal();

    // verify RANDAO reveal
    if (verify_signature) {
        if (!try verifyRandaoSignature(
            io,
            beacon_config,
            epoch_cache,
            randao_reveal,
            try state.slot(),
            proposer_idx,
        )) {
            return error.InvalidRandaoSignature;
        }
    }

    // mix in RANDAO reveal
    var randao_reveal_digest: [32]u8 = undefined;
    Sha256.hash(randao_reveal, &randao_reveal_digest, .{});

    var randao_mix: [32]u8 = undefined;
    const current_mix = try getRandaoMix(fork, state, epoch);
    xor(current_mix, &randao_reveal_digest, &randao_mix);
    try state.setRandaoMix(epoch, &randao_mix);
}

fn xor(a: *const [32]u8, b: *const [32]u8, out: *[32]u8) void {
    inline for (a, b, out) |a_i, b_i, *out_i| {
        out_i.* = a_i ^ b_i;
    }
}
