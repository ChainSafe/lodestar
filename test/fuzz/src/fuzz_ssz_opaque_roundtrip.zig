// Round-trip fuzz for the opaque-node SSZ tree paths:
//   chunked_leaf list/vector — tree.deserializeFromBytes / serializeIntoBytes /
//                              toValue / fromValue
//   container_struct         — the same four, plus tree.getValuePtr
//
// `fuzz_ssz_chunked_leaf_set` already covers the chunked_leaf TreeView ops
// (set/get/push/clone/commit/sliceTo); this target covers the byte- and
// value-level tree conversions that target never exercises.
//
// Input: [selector_byte][ssz_data...]
//   selector % 4: 0 = chunked_leaf List(u64)
//                 1 = chunked_leaf List(u32)
//                 2 = StructContainerType (fixed 52-byte container)
//                 3 = chunked_leaf Vector(u64)

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const ChunkedLeaf = pmt.ChunkedLeaf;

const fuzz_buffer_size: u32 = 64 * 1024 * 1024;
var fuzz_buf: [fuzz_buffer_size]u8 = undefined;

const Capacity: usize = 1 << 20;
const selector_count: u8 = 4;

// All-fixed fields with no bool, so every 52-byte input deserializes and the
// whole round-trip past deserialize gets exercised.
const ContainerT = ssz.StructContainerType(struct {
    x: ssz.UintType(64),
    y: ssz.UintType(32),
    z: ssz.UintType(64),
    blob: ssz.ByteVectorType(32),
});

// Length 2*K*4 + 7: spans two chunked_leaves with an odd tail, so the last
// chunked_leaf is partial.
const VecChunkedLeaf = ssz.FixedVectorType(ssz.UintType(64), ChunkedLeaf.K * 4 * 2 + 7, .{ .chunked_leaf = true });

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len < 2) return;

    var fba = std.heap.FixedBufferAllocator.init(&fuzz_buf);
    const allocator = fba.allocator();

    const data = buf[1..len];
    switch (buf[0] % selector_count) {
        0 => fuzzListRoundtrip(ssz.FixedListType(ssz.UintType(64), Capacity, .{ .chunked_leaf = true }), allocator, data),
        1 => fuzzListRoundtrip(ssz.FixedListType(ssz.UintType(32), Capacity, .{ .chunked_leaf = true }), allocator, data),
        2 => fuzzContainerRoundtrip(allocator, data),
        3 => fuzzVectorRoundtrip(VecChunkedLeaf, allocator, data),
        else => unreachable,
    }
}

fn fuzzListRoundtrip(comptime ListT: type, allocator: std.mem.Allocator, raw: []const u8) void {
    // deserializeFromBytes wants a whole number of elements; trim the tail.
    const elem_size = ListT.Element.fixed_size;
    const data = raw[0 .. raw.len - raw.len % elem_size];

    var pool = Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 8192,
    }) catch return;
    defer pool.deinit();

    // Pool baseline = pre-populated zero sentinels. Any tree id the round-trip
    // fails to unref accumulates here and trips the assert at function exit.
    const baseline_in_use = pool.getNodesInUse();
    var leak_check_armed = false;
    defer {
        if (leak_check_armed) {
            assert(pool.getNodesInUse() == baseline_in_use);
        }
    }

    const node = ListT.tree.deserializeFromBytes(&pool, data) catch return;
    defer pool.unref(node);
    leak_check_armed = true;

    // tree -> bytes round-trips back to the input.
    const size = ListT.tree.serializedSize(node, &pool) catch return;
    assert(size == data.len);
    const out = allocator.alloc(u8, size) catch return;
    defer allocator.free(out);
    const written = ListT.tree.serializeIntoBytes(node, &pool, out) catch return;
    assert(written == size);
    assert(std.mem.eql(u8, out, data));

    // tree -> value -> bytes round-trips too.
    var value: ListT.Type = .empty;
    defer value.deinit(allocator);
    ListT.tree.toValue(allocator, node, &pool, &value) catch return;
    const value_size = ListT.serializedSize(&value);
    assert(value_size == data.len);
    const value_out = allocator.alloc(u8, value_size) catch return;
    defer allocator.free(value_out);
    const value_written = ListT.serializeIntoBytes(&value, value_out);
    assert(value_written == value_size);
    assert(std.mem.eql(u8, value_out, data));

    // value -> tree rebuilds the same root.
    const rebuilt = ListT.tree.fromValue(&pool, &value) catch return;
    defer pool.unref(rebuilt);
    assert(std.mem.eql(u8, node.getRoot(&pool), rebuilt.getRoot(&pool)));
}

fn fuzzContainerRoundtrip(allocator: std.mem.Allocator, data: []const u8) void {
    if (data.len != ContainerT.fixed_size) return;

    var pool = Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    }) catch return;
    defer pool.deinit();

    const baseline_in_use = pool.getNodesInUse();
    var leak_check_armed = false;
    defer {
        if (leak_check_armed) {
            assert(pool.getNodesInUse() == baseline_in_use);
        }
    }

    const node = ContainerT.tree.deserializeFromBytes(&pool, data) catch return;
    defer pool.unref(node);
    leak_check_armed = true;

    // tree -> bytes round-trips back to the input.
    var out: [ContainerT.fixed_size]u8 = undefined;
    const written = ContainerT.tree.serializeIntoBytes(node, &pool, &out) catch return;
    assert(written == ContainerT.fixed_size);
    assert(std.mem.eql(u8, &out, data));

    // tree -> value -> bytes round-trips too.
    var value: ContainerT.Type = undefined;
    ContainerT.tree.toValue(node, &pool, &value) catch return;
    var value_out: [ContainerT.fixed_size]u8 = undefined;
    const value_written = ContainerT.serializeIntoBytes(&value, &value_out);
    assert(value_written == ContainerT.fixed_size);
    assert(std.mem.eql(u8, &value_out, data));

    // getValuePtr hands back the same struct toValue produced, with no copy.
    const value_ptr = ContainerT.tree.getValuePtr(node, &pool) catch return;
    assert(ContainerT.equals(value_ptr, &value));

    // value -> tree rebuilds the same root.
    const rebuilt = ContainerT.tree.fromValue(&pool, &value) catch return;
    defer pool.unref(rebuilt);
    assert(std.mem.eql(u8, node.getRoot(&pool), rebuilt.getRoot(&pool)));
}

fn fuzzVectorRoundtrip(comptime VecT: type, allocator: std.mem.Allocator, raw: []const u8) void {
    // A vector is fixed-size; take the leading fixed_size bytes.
    if (raw.len < VecT.fixed_size) return;
    const data = raw[0..VecT.fixed_size];

    var pool = Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 4096,
    }) catch return;
    defer pool.deinit();

    const baseline_in_use = pool.getNodesInUse();
    var leak_check_armed = false;
    defer {
        if (leak_check_armed) {
            assert(pool.getNodesInUse() == baseline_in_use);
        }
    }

    const node = VecT.tree.deserializeFromBytes(&pool, data) catch return;
    defer pool.unref(node);
    leak_check_armed = true;

    // tree -> bytes round-trips back to the input.
    var out: [VecT.fixed_size]u8 = undefined;
    const written = VecT.tree.serializeIntoBytes(node, &pool, &out) catch return;
    assert(written == VecT.fixed_size);
    assert(std.mem.eql(u8, &out, data));

    // tree -> value -> bytes round-trips too.
    var value: VecT.Type = undefined;
    VecT.tree.toValue(node, &pool, &value) catch return;
    var value_out: [VecT.fixed_size]u8 = undefined;
    const value_written = VecT.serializeIntoBytes(&value, &value_out);
    assert(value_written == VecT.fixed_size);
    assert(std.mem.eql(u8, &value_out, data));

    // value -> tree rebuilds the same root.
    const rebuilt = VecT.tree.fromValue(&pool, &value) catch return;
    defer pool.unref(rebuilt);
    assert(std.mem.eql(u8, node.getRoot(&pool), rebuilt.getRoot(&pool)));
}
