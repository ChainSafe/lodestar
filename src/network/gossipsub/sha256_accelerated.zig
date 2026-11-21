//! Gossip SHA-256 compiled apart from the network module. build.zig builds this root alone as an
//! object for the target's OS and ABI with the baseline CPU plus the features below, so std's
//! Sha256 takes its instruction-accelerated path here. `sha256.zig` calls it only after detecting
//! that the CPU and the OS support every one of these features.

const std = @import("std");
const builtin = @import("builtin");

/// Safety checks stay on but trap, so the object holds no panic machinery built with its features
/// and needs nothing from the Zig runtime a bitcode link (the fuzz harnesses) lacks.
pub const panic = std.debug.no_panic;

/// The features `sha256.zig`'s detector checks, beyond the baseline CPU.
const detected = switch (builtin.cpu.arch) {
    .x86_64 => std.Target.x86.featureSet(&.{ .sse3, .ssse3, .sse4_1, .sse4_2, .crc32, .avx, .avx2, .sha }),
    .aarch64 => std.Target.aarch64.featureSet(&.{ .fp_armv8, .neon, .sha2 }),
    else => @compileError("no accelerated gossip SHA-256 for this architecture"),
};

comptime {
    // A feature the detector does not check could put an instruction here that no check covers.
    var allowed = std.Target.Cpu.baseline(builtin.cpu.arch, builtin.os).features;
    allowed.addFeatureSet(detected);
    std.debug.assert(allowed.isSuperSetOf(builtin.cpu.features));
    std.debug.assert(builtin.cpu.features.isSuperSetOf(detected));
    @export(&digest, .{ .name = "lodestar_z_gossip_sha256", .visibility = .hidden });
}

fn digest(
    prefix: [*]const u8,
    prefix_len: usize,
    topic: [*]const u8,
    topic_len: usize,
    payload: [*]const u8,
    payload_len: usize,
    out: *[32]u8,
) callconv(.c) void {
    var state = std.crypto.hash.sha2.Sha256.init(.{});
    state.update(prefix[0..prefix_len]);
    state.update(topic[0..topic_len]);
    state.update(payload[0..payload_len]);
    state.final(out);
}
