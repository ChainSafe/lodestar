// Fuzz target for SSZ ByteListType deserialization.
//
// Input format: [selector_byte] [ssz_data...]
//   selector 0x00 → ByteList(32)
//   selector 0x01 → ByteList(256)
//   selector 0x02 → ByteList(1024)
//
// Tests: variable-length byte sequence validation, length limits.

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
        0 => fuzzByteList(
            ssz.ByteListType(32),
            allocator,
            data,
        ),
        1 => fuzzByteList(
            ssz.ByteListType(256),
            allocator,
            data,
        ),
        2 => fuzzByteList(
            ssz.ByteListType(1024),
            allocator,
            data,
        ),
        else => unreachable,
    }
}

fn fuzzByteList(
    comptime ByteListT: type,
    allocator: std.mem.Allocator,
    data: []const u8,
) void {
    var value: ByteListT.Type = ByteListT.Type.empty;
    ByteListT.deserializeFromBytes(
        allocator,
        data,
        &value,
    ) catch return;

    // Postcondition: deserialized length within limit.
    assert(value.items.len <= ByteListT.limit);
    // Postcondition: round-trip size must match input.
    const serialized_size = ByteListT.serializedSize(&value);
    assert(serialized_size == data.len);

    // Round-trip invariant.
    const output = allocator.alloc(
        u8,
        serialized_size,
    ) catch return;
    const written = ByteListT.serializeIntoBytes(
        &value,
        output,
    );
    assert(written == serialized_size);
    assert(std.mem.eql(u8, output, data));
}
