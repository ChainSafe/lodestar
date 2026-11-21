//! SHA-256 for the shuffle.
//!
//! std compiles either its hardware or its portable SHA-256, chosen from the target CPU. Release
//! binaries target a baseline CPU, which on most targets lacks the instructions, so std there is
//! portable code even on a machine that has them. blst carries both and chooses on every call.
//! It is used unless the target CPU guarantees the instructions, where std is inlined and faster.

const std = @import("std");
const builtin = @import("builtin");
const blst = @import("blst");
const StdSha256 = std.crypto.hash.sha2.Sha256;

pub const digest_length = StdSha256.digest_length;

/// The condition std's SHA-256 tests before compiling its hardware path. If the two drift apart,
/// only speed changes: both branches of `hash` return the same digest.
const std_uses_hardware = builtin.zig_backend != .stage2_c and switch (builtin.cpu.arch) {
    .x86_64 => builtin.cpu.hasAll(.x86, &.{ .sha, .avx2 }),
    .aarch64 => builtin.cpu.has(.aarch64, .sha2),
    else => false,
};

pub fn hash(message: []const u8, out: *[digest_length]u8) void {
    if (std_uses_hardware) {
        StdSha256.hash(message, out, .{});
    } else {
        blst.blst_sha256(out, message.ptr, message.len);
    }
}

test {
    _ = @import("sha256_test.zig");
}
