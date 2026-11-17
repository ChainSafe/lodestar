// Fuzz target for SSZ basic types: Bool, Uint8/16/32/64/128/256.
//
// Input format: [selector_byte] [ssz_data...]
//   selector 0x00 → Bool
//   selector 0x01 → Uint8
//   selector 0x02 → Uint16
//   selector 0x03 → Uint32
//   selector 0x04 → Uint64
//   selector 0x05 → Uint128
//   selector 0x06 → Uint256
//
// Round-trip invariant: serialize(deserialize(data)) == data.

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");

const selector_count: u32 = 7;

pub export fn zig_fuzz_init() callconv(.c) void {
    // No initialization needed for basic types.
    // They use stack-only deserialization.
}

pub export fn zig_fuzz_test(
    buf: [*]const u8,
    len: usize,
) callconv(.c) void {
    if (len < 2) return;

    const selector = buf[0];
    const data = buf[1..len];

    switch (selector % selector_count) {
        0 => fuzzBool(data),
        1 => fuzzUint(ssz.UintType(8), data),
        2 => fuzzUint(ssz.UintType(16), data),
        3 => fuzzUint(ssz.UintType(32), data),
        4 => fuzzUint(ssz.UintType(64), data),
        5 => fuzzUint(ssz.UintType(128), data),
        6 => fuzzUint(ssz.UintType(256), data),
        else => unreachable,
    }
}

fn fuzzBool(data: []const u8) void {
    const BoolType = ssz.BoolType();
    // Precondition: Bool has a fixed serialized size.
    if (data.len != BoolType.fixed_size) return;

    var value: BoolType.Type = undefined;
    BoolType.deserializeFromBytes(data, &value) catch return;

    // Postcondition: deserialized bool is valid.
    assert(value == true or value == false);

    // Round-trip invariant.
    var serialized: [BoolType.fixed_size]u8 = undefined;
    const written = BoolType.serializeIntoBytes(
        &value,
        &serialized,
    );
    assert(written == BoolType.fixed_size);
    assert(std.mem.eql(u8, &serialized, data));
}

fn fuzzUint(comptime UintT: type, data: []const u8) void {
    // Precondition: uint width implies exact serialized size.
    if (data.len != UintT.fixed_size) return;

    var value: UintT.Type = undefined;
    UintT.deserializeFromBytes(data, &value) catch return;

    // Round-trip invariant.
    var serialized: [UintT.fixed_size]u8 = undefined;
    const written = UintT.serializeIntoBytes(
        &value,
        &serialized,
    );
    assert(written == UintT.fixed_size);
    assert(std.mem.eql(u8, &serialized, data));
}
