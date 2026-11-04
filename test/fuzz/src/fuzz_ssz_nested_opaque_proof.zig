// Input: [seed_byte][op records of 2 bytes each]
//   seed_byte: mixed into the vector's content so identical fuzz inputs
//     materialize distinct chunked_leaf chunks
//   op record (2 bytes): le u16 reduced to gindex in [1, 4095]; covers
//     the container_struct root, both fields, and every internal/leaf node
//     of the vec field's 1024-chunk subtree (including the chunked_leaf
//     nodes it is built from). Out-of-tree gindices fall in the same band
//     and exercise createSingleProof's InvalidNode/InvalidGindex paths.

const std = @import("std");
const assert = std.debug.assert;
const ssz = @import("ssz");
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const Gindex = pmt.Gindex;
const proof = pmt.proof;

const fuzz_buffer_size: u32 = 64 * 1024 * 1024;
var fuzz_buf: [fuzz_buffer_size]u8 = undefined;

// StructContainerType makes the root a `.container_struct` opaque, and the
// `vec` field's chunked_leaf list is built from `.chunked_leaf` nodes. Any
// proof targeting nodes inside the vector must traverse both opaque kinds.
const Vec = ssz.FixedVectorType(ssz.UintType(64), 4096, .{ .chunked_leaf = true });
const Outer = ssz.StructContainerType(struct {
    vec: Vec,
    tag: ssz.UintType(64),
});

const op_size: usize = 2;
const gindex_min: u64 = 1;
const gindex_max: u64 = 4095;
const gindex_span: u64 = gindex_max - gindex_min + 1;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(buf: [*]const u8, len: usize) callconv(.c) void {
    if (len < 1 + op_size) return;

    var fba = std.heap.FixedBufferAllocator.init(&fuzz_buf);
    const allocator = fba.allocator();

    var value: Outer.Type = .{
        .vec = Vec.default_value,
        .tag = 0,
    };
    const seed = buf[0];
    for (0..Vec.length) |i| {
        value.vec[i] = (@as(u64, @intCast(i)) +% @as(u64, seed)) *% 0x100000001b3;
    }
    value.tag = (@as(u64, seed) << 56) | 0x42;

    var pool = Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 8192,
    }) catch return;
    defer pool.deinit();

    // Pool baseline = pre-populated zero sentinels. Final assert catches
    // any transient ref/unref imbalance introduced by createSingleProof or
    // its materialize plumbing.
    const baseline_in_use = pool.getNodesInUse();
    var leak_check_armed = false;
    defer {
        if (leak_check_armed) {
            const final_in_use = pool.getNodesInUse();
            assert(final_in_use == baseline_in_use);
        }
    }

    const root = Outer.tree.fromValue(&pool, &value) catch return;
    defer pool.unref(root);

    const original_root = root.getRoot(&pool).*;

    leak_check_armed = true;

    var i: usize = 1;
    while (i + op_size <= len) : (i += op_size) {
        const raw = (@as(u64, buf[i + 1]) << 8) | @as(u64, buf[i]);
        const g = gindex_min + (raw % gindex_span);
        const gindex = Gindex.fromUint(g);

        var single_proof = proof.createSingleProof(allocator, &pool, root, gindex) catch continue;
        defer single_proof.deinit(allocator);

        var pool2 = Node.Pool.init(.{
            .page_allocator = allocator,
            .allocator = allocator,
            .pool_size = 64,
        }) catch continue;
        defer pool2.deinit();

        const rebuilt = proof.createNodeFromSingleProof(
            &pool2,
            gindex,
            single_proof.leaf,
            single_proof.witnesses,
        ) catch continue;
        defer pool2.unref(rebuilt);

        // A correct single proof rebuilds to the original root hash.
        const rebuilt_root = rebuilt.getRoot(&pool2).*;
        assert(std.mem.eql(u8, &original_root, &rebuilt_root));
    }
}
