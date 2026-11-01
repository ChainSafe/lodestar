//! Decodes one wire-carried consensus type through its three implementations, the value
//! decoder, the serialized-bytes validator and the tree decoder, and requires them to agree on
//! acceptance, on the re-encoded bytes and on the hash tree root. Freed through a leak-checking
//! allocator so a decoder that drops a partial value on a malformed input fails here.
const std = @import("std");

/// Exit 99 lets AFL detect panics without waiting for symbolization or a core dump handler.
pub const panic = std.debug.FullPanic(fuzzPanic);

fn fuzzPanic(text: []const u8, ret_addr: ?usize) noreturn {
    const addr = (ret_addr orelse @returnAddress()) -% std.process.getBaseAddress();
    std.debug.print("panic: {s} at +0x{x}\n", .{ text, addr });
    std.process.exit(99);
}
const assert = std.debug.assert;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const wire_types = @import("ssz_wire_types");

const pool_size: u32 = 1 << 17;
const scratch_size: usize = 64 * 1024 * 1024;
var scratch: [scratch_size]u8 = undefined;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len < 2) return;
    const data = buf[1..len];
    const selector = @as(usize, buf[0]) % wire_types.entries.len;
    inline for (wire_types.entries, 0..) |entry, index| {
        if (selector == index) return fuzzType(entry.T, data);
    }
    unreachable;
}

fn fuzzType(comptime T: type, data: []const u8) void {
    const fixed = comptime @hasDecl(T, "fixed_size");
    if (fixed) {
        if (data.len != T.fixed_size) return;
    } else {
        if (data.len < T.min_size or data.len > T.max_size) return;
    }

    // Backed by the static buffer so the leak checker's address-keyed bookkeeping takes the same
    // branches on every run; a page-backed one varies with mmap placement and costs stability.
    var fba = std.heap.FixedBufferAllocator.init(&scratch);
    var gpa: std.heap.DebugAllocator(.{
        .stack_trace_frames = 0,
        .thread_safe = false,
        .backing_allocator_zeroes = false,
    }) = .{ .backing_allocator = fba.allocator() };
    defer assert(gpa.deinit() == .ok);
    const allocator = gpa.allocator();

    const valid = blk: {
        T.serialized.validate(data) catch break :blk false;
        break :blk true;
    };

    var value: T.Type = T.default_value;
    defer if (comptime !fixed) T.deinit(allocator, &value);
    const accepted = blk: {
        if (fixed) {
            T.deserializeFromBytes(data, &value) catch break :blk false;
        } else {
            T.deserializeFromBytes(allocator, data, &value) catch |err| {
                if (err == error.OutOfMemory) return;
                break :blk false;
            };
        }
        break :blk true;
    };
    assert(accepted == valid);
    if (!accepted) return;

    const size = if (fixed) T.fixed_size else T.serializedSize(&value);
    assert(size == data.len);
    const out = allocator.alloc(u8, size) catch return;
    defer allocator.free(out);
    assert(T.serializeIntoBytes(&value, out) == size);
    assert(std.mem.eql(u8, out, data));

    var value_root: [32]u8 = undefined;
    if (fixed) {
        T.hashTreeRoot(&value, &value_root) catch return;
    } else {
        T.hashTreeRoot(allocator, &value, &value_root) catch return;
    }
    var serialized_root: [32]u8 = undefined;
    if (fixed) {
        T.serialized.hashTreeRoot(data, &serialized_root) catch return;
    } else {
        T.serialized.hashTreeRoot(allocator, data, &serialized_root) catch return;
    }
    assert(std.mem.eql(u8, &value_root, &serialized_root));

    var pool = Node.Pool.init(.{
        .page_allocator = fba.allocator(),
        .allocator = fba.allocator(),
        .pool_size = pool_size,
    }) catch return;
    defer pool.deinit();
    const baseline_in_use = pool.getNodesInUse();
    var leak_check_armed = false;
    defer if (leak_check_armed) assert(pool.getNodesInUse() == baseline_in_use);

    const node = T.tree.deserializeFromBytes(&pool, data) catch |err| {
        if (err == error.OutOfMemory) return;
        @panic("tree decoder rejected bytes the value decoder accepted");
    };
    defer pool.unref(node);
    leak_check_armed = true;
    assert(std.mem.eql(u8, node.getRoot(&pool), &value_root));

    const tree_size = if (fixed) T.fixed_size else T.tree.serializedSize(node, &pool) catch return;
    assert(tree_size == data.len);
    const tree_out = allocator.alloc(u8, tree_size) catch return;
    defer allocator.free(tree_out);
    assert((T.tree.serializeIntoBytes(node, &pool, tree_out) catch return) == tree_size);
    assert(std.mem.eql(u8, tree_out, data));

    var from_tree: T.Type = T.default_value;
    defer if (comptime !fixed) T.deinit(allocator, &from_tree);
    if (fixed) {
        T.tree.toValue(node, &pool, &from_tree) catch return;
    } else {
        T.tree.toValue(allocator, node, &pool, &from_tree) catch return;
    }
    assert(T.equals(&value, &from_tree));

    const rebuilt = T.tree.fromValue(&pool, &value) catch return;
    defer pool.unref(rebuilt);
    assert(std.mem.eql(u8, rebuilt.getRoot(&pool), &value_root));
}
