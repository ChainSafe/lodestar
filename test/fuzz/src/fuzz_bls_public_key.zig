const std = @import("std");
const assert = std.debug.assert;
const bls = @import("bls");

const PublicKey = bls.PublicKey;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(
    buf: [*]const u8,
    len: usize,
) callconv(.c) void {
    if (len == 0) return;
    if (len > PublicKey.SERIALIZE_SIZE) return;
    const input = buf[0..len];

    const pk = PublicKey.deserialize(input) catch |err| {
        switch (err) {
            error.BadEncoding, error.PointNotOnCurve, error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected public key decode error"),
        }
    };

    pk.validate() catch |err| {
        switch (err) {
            error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected public key validation error"),
        }
    };

    const encoded = pk.serialize();
    const pk2 = PublicKey.deserialize(&encoded) catch |err| {
        switch (err) {
            error.BadEncoding, error.PointNotOnCurve, error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected public key roundtrip error"),
        }
    };
    pk2.validate() catch |err| {
        switch (err) {
            error.PointNotInGroup, error.PkIsInfinity => return,
            else => @panic("unexpected public key validation error"),
        }
    };
    const encoded2 = pk2.serialize();
    assert(std.mem.eql(u8, &encoded, &encoded2));
}
