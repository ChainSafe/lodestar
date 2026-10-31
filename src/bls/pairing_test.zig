//! Tests for `Pairing.zig`.

const std = @import("std");
const c = @import("root.zig").c;
const Pairing_mod = @import("Pairing.zig");
const buf_align = Pairing_mod.buf_align;
const init = Pairing_mod.init;
const sizeOf = Pairing_mod.sizeOf;

test "init Pairing" {
    var buffer: [sizeOf()]u8 align(buf_align) = undefined;

    const dst = "destination";
    _ = Pairing_mod.init(&buffer, true, dst);
}

test "sizeOf Pairing" {
    try std.testing.expectEqual(
        c.blst_pairing_sizeof(),
        Pairing_mod.sizeOf(),
    );
}
