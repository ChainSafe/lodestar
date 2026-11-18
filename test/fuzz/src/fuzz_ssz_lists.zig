// Fuzz target for SSZ list type deserialization.
//
// Input format: [selector_byte] [ssz_data...]
//
// FixedListType (fixed-size elements):
//   0x00 → FixedList(Uint64, 128)
//   0x01 → FixedList(Uint32, 256)
//   0x02 → FixedList(Bool, 64)
//
// VariableListType (variable-size elements):
//   0x03 → VariableList(ByteList(256), 16)

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");

const selector_count: u32 = 4;
const fuzz_buffer_size: u32 = 64 * 1024 * 1024;

var fuzz_buf: [fuzz_buffer_size]u8 = undefined;

const Uint64 = ssz.UintType(64);
const Uint32 = ssz.UintType(32);
const BoolT = ssz.BoolType();

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
        0 => fuzzFixedList(
            ssz.FixedListType(Uint64, 128, .{}),
            allocator,
            data,
        ),
        1 => fuzzFixedList(
            ssz.FixedListType(Uint32, 256, .{}),
            allocator,
            data,
        ),
        2 => fuzzFixedList(
            ssz.FixedListType(BoolT, 64, .{}),
            allocator,
            data,
        ),
        3 => fuzzVariableList(
            ssz.VariableListType(ssz.ByteListType(256), 16),
            allocator,
            data,
        ),
        else => unreachable,
    }
}

fn fuzzFixedList(
    comptime ListT: type,
    allocator: std.mem.Allocator,
    data: []const u8,
) void {
    var value: ListT.Type = ListT.Type.empty;
    ListT.deserializeFromBytes(
        allocator,
        data,
        &value,
    ) catch return;

    // Postcondition: element count within limit.
    assert(value.items.len <= ListT.limit);
    // Postcondition: data length matches elements.
    assert(
        data.len == value.items.len * ListT.Element.fixed_size,
    );

    // Round-trip invariant.
    const serialized_size = ListT.serializedSize(&value);
    assert(serialized_size == data.len);
    const output = allocator.alloc(
        u8,
        serialized_size,
    ) catch return;
    const written = ListT.serializeIntoBytes(&value, output);
    assert(written == serialized_size);
    assert(std.mem.eql(u8, output, data));
}

fn fuzzVariableList(
    comptime ListT: type,
    allocator: std.mem.Allocator,
    data: []const u8,
) void {
    var value: ListT.Type = ListT.Type.empty;
    ListT.deserializeFromBytes(
        allocator,
        data,
        &value,
    ) catch return;

    // Postcondition: element count within limit.
    assert(value.items.len <= ListT.limit);

    // Round-trip invariant.
    const serialized_size = ListT.serializedSize(&value);
    assert(serialized_size == data.len);
    const output = allocator.alloc(
        u8,
        serialized_size,
    ) catch return;
    const written = ListT.serializeIntoBytes(&value, output);
    assert(written == serialized_size);
    assert(std.mem.eql(u8, output, data));
}
