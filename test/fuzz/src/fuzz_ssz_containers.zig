// Fuzz target for SSZ container deserialization (fixed and variable).
//
// Input format: [selector_byte] [ssz_data...]
//
// Fixed containers (no allocator needed):
//   0x00 → Fork (16 bytes)
//   0x01 → Checkpoint (40 bytes)
//   0x02 → AttestationData (128 bytes)
//   0x03 → Eth1Data (72 bytes)
//   0x04 → BeaconBlockHeader (112 bytes)
//   0x05 → Validator (121 bytes)
//
// Variable containers (allocator needed):
//   0x06 → Attestation
//   0x07 → IndexedAttestation

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");
const consensus_types = @import("consensus_types");
const phase0 = consensus_types.phase0;

const selector_count: u32 = 8;
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
        // Fixed containers.
        0 => fuzzFixedContainer(phase0.Fork, data),
        1 => fuzzFixedContainer(phase0.Checkpoint, data),
        2 => fuzzFixedContainer(
            phase0.AttestationData,
            data,
        ),
        3 => fuzzFixedContainer(phase0.Eth1Data, data),
        4 => fuzzFixedContainer(
            phase0.BeaconBlockHeader,
            data,
        ),
        5 => fuzzFixedContainer(phase0.Validator, data),
        // Variable containers.
        6 => fuzzVariableContainer(
            phase0.Attestation,
            allocator,
            data,
        ),
        7 => fuzzVariableContainer(
            phase0.IndexedAttestation,
            allocator,
            data,
        ),
        else => unreachable,
    }
}

fn fuzzFixedContainer(
    comptime ContainerT: type,
    data: []const u8,
) void {
    // Precondition: fixed containers require exact serialized size.
    if (data.len != ContainerT.fixed_size) return;

    var value: ContainerT.Type = undefined;
    ContainerT.deserializeFromBytes(
        data,
        &value,
    ) catch return;

    // Round-trip invariant.
    var serialized: [ContainerT.fixed_size]u8 = undefined;
    const written = ContainerT.serializeIntoBytes(
        &value,
        &serialized,
    );
    assert(written == ContainerT.fixed_size);
    assert(std.mem.eql(u8, &serialized, data));
}

fn fuzzVariableContainer(
    comptime ContainerT: type,
    allocator: std.mem.Allocator,
    data: []const u8,
) void {
    // Precondition: input length must be within declared bounds.
    if (data.len < ContainerT.min_size) return;
    if (data.len > ContainerT.max_size) return;

    var value: ContainerT.Type = ContainerT.default_value;
    ContainerT.deserializeFromBytes(
        allocator,
        data,
        &value,
    ) catch return;

    // Round-trip invariant.
    const serialized_size = ContainerT.serializedSize(&value);
    assert(serialized_size == data.len);
    const output = allocator.alloc(
        u8,
        serialized_size,
    ) catch return;
    const written = ContainerT.serializeIntoBytes(
        &value,
        output,
    );
    assert(written == serialized_size);
    assert(std.mem.eql(u8, output, data));
}
