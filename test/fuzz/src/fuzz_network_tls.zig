const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const network = @import("network");

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(bytes: [*]const u8, len: usize) callconv(.c) void {
    if (len > 4096) return;
    const peer = network.tls.verify.verifyDer(bytes[0..len], 1_800_000_000) catch return;
    const key = peer.publicKey() catch @panic("verified certificate returned an invalid identity");
    const canonical = network.PeerId.fromPublicKey(&key);
    std.debug.assert(peer.eql(&canonical));
}
