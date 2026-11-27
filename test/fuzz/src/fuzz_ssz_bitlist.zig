// Fuzz target for SSZ BitListType deserialization.
//
// Input format: [selector_byte] [ssz_data...]
//   selector 0x00 → BitList(8)
//   selector 0x01 → BitList(64)
//   selector 0x02 → BitList(2048)
//
// Tests: padding bit parsing, sentinel validation, length limits.

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");

const selector_count: u32 = 3;
const fuzz_buffer_size: u32 = 64 * 1024 * 1024;

var fuzz_buf: [fuzz_buffer_size]u8 = undefined;

pub export fn zig_fuzz_init() callconv(.c) void {
    // No initialization needed.
    // FixedBufferAllocator is reset per iteration.
}

pub export fn zig_fuzz_test(
    buf: [*]const u8,
    len: usize,
) callconv(.c) void {
    // Precondition: need at least selector + 1 byte of data.
    if (len < 2) return;

    var fixed_buffer_allocator =
        std.heap.FixedBufferAllocator.init(&fuzz_buf);
    const allocator = fixed_buffer_allocator.allocator();

    const selector = buf[0];
    const data = buf[1..len];

    switch (selector % selector_count) {
        0 => fuzzBitList(ssz.BitListType(8), allocator, data),
        1 => fuzzBitList(ssz.BitListType(64), allocator, data),
        2 => fuzzBitList(
            ssz.BitListType(2048),
            allocator,
            data,
        ),
        else => unreachable,
    }
}

fn fuzzBitList(
    comptime BitListT: type,
    allocator: std.mem.Allocator,
    data: []const u8,
) void {
    var value: BitListT.Type = BitListT.Type.empty;
    BitListT.deserializeFromBytes(
        allocator,
        data,
        &value,
    ) catch return;

    // Postcondition: bit length within declared limit.
    assert(value.bit_len <= BitListT.limit);
    // Postcondition: serialized form must be non-empty
    // (sentinel bit requires at least 1 byte).
    const serialized_size = BitListT.serializedSize(&value);
    assert(serialized_size > 0);

    // Round-trip invariant.
    const output = allocator.alloc(
        u8,
        serialized_size,
    ) catch return;
    const written = BitListT.serializeIntoBytes(
        &value,
        output,
    );
    assert(written == serialized_size);
    assert(std.mem.eql(u8, output, data));
}
