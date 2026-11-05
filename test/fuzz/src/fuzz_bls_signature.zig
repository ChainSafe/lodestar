const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const assert = std.debug.assert;
const bls = @import("bls");

const Signature = bls.Signature;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(
    buf: [*]const u8,
    len: usize,
) callconv(.c) void {
    if (len == 0 or len > Signature.SERIALIZE_SIZE) return;
    const input = buf[0..len];

    const sig = Signature.deserialize(input) catch |err| {
        switch (err) {
            error.BadEncoding, error.PointNotOnCurve, error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected signature decode error"),
        }
    };

    sig.validate(true) catch |err| {
        switch (err) {
            error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected signature validation error"),
        }
    };

    const encoded = sig.serialize();
    const sig2 = Signature.deserialize(&encoded) catch |err| {
        switch (err) {
            error.BadEncoding, error.PointNotOnCurve, error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected signature roundtrip error"),
        }
    };
    sig2.validate(true) catch |err| {
        switch (err) {
            error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected signature validation error"),
        }
    };
    const encoded2 = sig2.serialize();
    assert(std.mem.eql(u8, &encoded, &encoded2));
}
