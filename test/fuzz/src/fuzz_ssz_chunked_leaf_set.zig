// Input: [selector_byte][op records of 4 bytes each]
//   selector % 4: 0/1 = u64 populated/empty, 2/3 = u32 populated/empty
//   op % 7: 0=set, 1=commit+root check, 2=get, 3=push, 4=clone-deinit,
//           5=sliceTo, 6=getAllInto
//   record layout: [op, arg_lo, arg_hi, val_seed]

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const ChunkedLeaf = pmt.ChunkedLeaf;

const fuzz_buffer_size: u32 = 64 * 1024 * 1024;
var fuzz_buf: [fuzz_buffer_size]u8 = undefined;

const Capacity: usize = 1 << 20;
// One past chunked_leaf 0 for the u64 list (4 items per chunk) so `push`
// crosses the CL0 -> CL1 boundary into the new-chunked_leaf path.
const ItemCount: usize = ChunkedLeaf.K * 4 + 1;

const op_size: usize = 4;
const selector_count: u8 = 4;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len < 1 + op_size) return;

    var fba = std.heap.FixedBufferAllocator.init(&fuzz_buf);
    const allocator = fba.allocator();

    const data = buf[1..len];
    switch (buf[0] % selector_count) {
        0 => fuzzListOps(ssz.FixedListType(ssz.UintType(64), Capacity, .{ .chunked_leaf = true }), allocator, data, 64),
        1 => fuzzListOps(ssz.FixedListType(ssz.UintType(64), Capacity, .{ .chunked_leaf = true }), allocator, data, 0),
        2 => fuzzListOps(ssz.FixedListType(ssz.UintType(32), Capacity, .{ .chunked_leaf = true }), allocator, data, 64),
        3 => fuzzListOps(ssz.FixedListType(ssz.UintType(32), Capacity, .{ .chunked_leaf = true }), allocator, data, 0),
        else => unreachable,
    }
}

fn fuzzListOps(
    comptime ListT: type,
    allocator: std.mem.Allocator,
    data: []const u8,
    initial_count: usize,
) void {
    const Element = ListT.Element.Type;
    const items_per_chunk: usize = 32 / ListT.Element.fixed_size;
    const K: usize = ChunkedLeaf.K;
    // +1 for the list length-mixin level above the data subtree.
    const cl_depth = ListT.chunk_depth + 1 - ChunkedLeaf.k_log2;

    var pool = Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 4096,
    }) catch return;
    defer pool.deinit();

    // Pool baseline = pre-populated zero sentinels (max_depth of them).
    // Any future regression in set/commit/push/clone that fails to unref a
    // transient Pool slot will accumulate over the op stream and trip this
    // assert at function exit (after view.deinit releases the tree).
    const baseline_in_use = pool.getNodesInUse();
    var leak_check_armed = false;
    defer {
        if (leak_check_armed) {
            const final_in_use = pool.getNodesInUse();
            assert(final_in_use == baseline_in_use);
        }
    }

    var reference = std.ArrayList(Element).empty;
    defer reference.deinit(allocator);
    reference.ensureTotalCapacity(allocator, ItemCount) catch return;
    for (0..initial_count) |i| reference.append(allocator, computeInitial(Element, i)) catch return;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    src.ensureTotalCapacity(allocator, initial_count) catch return;
    for (reference.items) |v| src.append(allocator, v) catch return;

    const root_id = ListT.tree.fromValue(&pool, &src) catch return;
    var view = ListT.TreeView.init(allocator, &pool, root_id) catch return;
    defer view.deinit();

    // Setup complete: arm the leak check so it fires at function exit.
    leak_check_armed = true;

    var i: usize = 0;
    while (i + op_size <= data.len) : (i += op_size) {
        const op = data[i] % 7;
        const arg_lo = data[i + 1];
        const arg_hi = data[i + 2];
        const val_seed = data[i + 3];

        switch (op) {
            0 => {
                if (reference.items.len == 0) continue;
                const idx = (@as(usize, arg_hi) << 8 | @as(usize, arg_lo)) % reference.items.len;
                const val = elementFromSeed(Element, val_seed);
                reference.items[idx] = val;
                view.set(idx, val) catch return;
            },
            1 => {
                const view_root = (view.hashTreeRoot() catch return).*;

                var ref_src: ListT.Type = .empty;
                defer ref_src.deinit(allocator);
                ref_src.ensureTotalCapacity(allocator, reference.items.len) catch return;
                for (reference.items) |v| ref_src.append(allocator, v) catch return;

                const ref_root_id = ListT.tree.fromValue(&pool, &ref_src) catch return;
                defer pool.unref(ref_root_id);
                const ref_root = ref_root_id.getRoot(&pool).*;

                assert(std.mem.eql(u8, &ref_root, &view_root));

                // Each ChunkedLeaf's `len` must track the list length. The
                // root check above can't catch a stale `len` — computeRoot
                // hashes all K chunks and ignores `len`.
                const len = reference.items.len;
                if (len > 0) {
                    const total_chunks = (len + items_per_chunk - 1) / items_per_chunk;
                    const cl_count = (total_chunks + K - 1) / K;
                    for (0..cl_count) |cl_idx| {
                        const cl = view.chunks.state.root.getNodeAtDepth(&pool, cl_depth, cl_idx) catch return;
                        const expected: u16 = @intCast(@min(K, total_chunks - cl_idx * K));
                        assert((cl.getChunkedLeafLen(&pool) catch return) == expected);
                    }
                }
            },
            2 => {
                if (reference.items.len == 0) continue;
                const idx = (@as(usize, arg_hi) << 8 | @as(usize, arg_lo)) % reference.items.len;
                const got = view.get(idx) catch return;
                assert(elementEql(Element, got, reference.items[idx]));
            },
            3 => {
                if (reference.items.len >= ItemCount) continue;
                const val = elementFromSeed(Element, val_seed);
                reference.append(allocator, val) catch return;
                view.push(val) catch return;
            },
            4 => {
                // transfer_cache=false so source's pending writes survive; the
                // default true clears source's `changed`, which would silently
                // drift `reference` ahead of `view`.
                const clone = view.clone(.{ .transfer_cache = false }) catch return;
                clone.deinit();
            },
            5 => {
                if (reference.items.len == 0) continue;
                const idx = (@as(usize, arg_hi) << 8 | @as(usize, arg_lo)) % reference.items.len;
                const sliced = view.sliceTo(idx) catch return;
                defer sliced.deinit();
                const sliced_root = (sliced.hashTreeRoot() catch return).*;

                // sliceTo(idx) keeps elements 0..=idx; idx is in [0, len-1].
                const expected_len = idx + 1;
                var ref_src: ListT.Type = .empty;
                defer ref_src.deinit(allocator);
                ref_src.ensureTotalCapacity(allocator, expected_len) catch return;
                for (reference.items[0..expected_len]) |v| ref_src.append(allocator, v) catch return;

                const ref_root_id = ListT.tree.fromValue(&pool, &ref_src) catch return;
                defer pool.unref(ref_root_id);

                assert(std.mem.eql(u8, ref_root_id.getRoot(&pool), &sliced_root));
            },
            6 => {
                // getAllInto sees uncommitted set/push, so it must match the
                // running reference without a commit.
                const buf = allocator.alloc(Element, reference.items.len) catch return;
                defer allocator.free(buf);
                const filled = view.getAllInto(buf) catch return;
                assert(filled.len == reference.items.len);
                for (filled, reference.items) |a, b| assert(elementEql(Element, a, b));
            },
            else => unreachable,
        }
    }
}

inline fn computeInitial(comptime Element: type, i: usize) Element {
    if (Element == u64) return @as(u64, @intCast(i)) *% 31 +% 7;
    if (Element == u32) return @as(u32, @intCast((i *% 31 +% 7) & 0xFFFFFFFF));
    @compileError("computeInitial: unsupported Element type");
}

inline fn elementFromSeed(comptime Element: type, seed: u8) Element {
    return @as(Element, @intCast(seed));
}

inline fn elementEql(comptime Element: type, a: Element, b: Element) bool {
    return a == b;
}
