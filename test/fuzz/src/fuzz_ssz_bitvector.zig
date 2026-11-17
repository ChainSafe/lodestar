// Fuzz target for SSZ BitVectorType deserialization.
//
// Input format: [selector_byte] [ssz_data...]
//   selector 0x00 → BitVector(4)
//   selector 0x01 → BitVector(32)
//   selector 0x02 → BitVector(64)
//   selector 0x03 → BitVector(512)
//
// Tests: fixed-length bitfield validation, trailing zeros enforcement.

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");

const selector_count: u32 = 4;

pub export fn zig_fuzz_init() callconv(.c) void {
    // No initialization needed for fixed-size types.
    // BitVector uses stack-only deserialization.
}

pub export fn zig_fuzz_test(
    buf: [*]const u8,
    len: usize,
) callconv(.c) void {
    // Precondition: need at least selector + 1 byte of data.
    if (len < 2) return;

    const selector = buf[0];
    const data = buf[1..len];

    switch (selector % selector_count) {
        0 => fuzzBitVector(ssz.BitVectorType(4), data),
        1 => fuzzBitVector(ssz.BitVectorType(32), data),
        2 => fuzzBitVector(ssz.BitVectorType(64), data),
        3 => fuzzBitVector(ssz.BitVectorType(512), data),
        else => unreachable,
    }
}

fn fuzzBitVector(
    comptime BitVectorT: type,
    data: []const u8,
) void {
    // Precondition: bitvector has fixed serialized size.
    if (data.len != BitVectorT.fixed_size) return;

    var value: BitVectorT.Type = undefined;
    BitVectorT.deserializeFromBytes(data, &value) catch return;

    // Round-trip invariant.
    var serialized: [BitVectorT.fixed_size]u8 = undefined;
    const written = BitVectorT.serializeIntoBytes(
        &value,
        &serialized,
    );
    assert(written == BitVectorT.fixed_size);
    assert(std.mem.eql(u8, &serialized, data));
}
