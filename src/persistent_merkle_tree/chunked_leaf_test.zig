//! Tests for `ChunkedLeaf.zig`.
//! Chunked-leaf payload.
//!
//! Replaces K individual leaf Nodes with a single heap blob (chunk
//! array + length) referenced by one `.chunked_leaf` Node. Self-contained,
//! ref-counted via the Pool's Node ref count, copy-on-write on mutation.
const std = @import("std");
const hashing = @import("hashing");
const ChunkedLeaf = @import("ChunkedLeaf.zig");
const Node = @import("Node.zig");
const ChunkedLeaf_mod = @import("ChunkedLeaf.zig");
const K = ChunkedLeaf_mod.K;
const computeRoot = ChunkedLeaf_mod.computeRoot;
const k_log2 = ChunkedLeaf_mod.k_log2;

test "computeRoot for all-zero chunked_leaf equals getZeroHash(k_log2)" {
    const allocator = std.testing.allocator;
    const chunked_leaf = try allocator.create(ChunkedLeaf);
    defer allocator.destroy(chunked_leaf);
    chunked_leaf.* = std.mem.zeroes(ChunkedLeaf);

    const scratch_slice = try allocator.alignedAlloc([32]u8, .@"64", K / 2);
    defer allocator.free(scratch_slice);
    const scratch: *align(64) [K / 2][32]u8 = @ptrCast(scratch_slice.ptr);

    var chunked_leaf_root: [32]u8 = undefined;
    chunked_leaf.computeRoot(scratch, &chunked_leaf_root);

    const expected = hashing.getZeroHash(k_log2);
    try std.testing.expectEqualSlices(u8, expected, &chunked_leaf_root);
}

test "computeRoot for non-zero pattern matches std merkleize" {
    const allocator = std.testing.allocator;
    const chunked_leaf = try allocator.create(ChunkedLeaf);
    defer allocator.destroy(chunked_leaf);
    chunked_leaf.len = K;

    for (0..K) |i| {
        std.mem.writeInt(u256, &chunked_leaf.chunks[i], @as(u256, @intCast(i + 1)), .little);
    }

    const scratch_slice = try allocator.alignedAlloc([32]u8, .@"64", K / 2);
    defer allocator.free(scratch_slice);
    const scratch: *align(64) [K / 2][32]u8 = @ptrCast(scratch_slice.ptr);

    var chunked_leaf_root: [32]u8 = undefined;
    chunked_leaf.computeRoot(scratch, &chunked_leaf_root);

    var pairs = try allocator.alloc([2][32]u8, K / 2);
    defer allocator.free(pairs);
    for (0..K / 2) |i| {
        pairs[i][0] = chunked_leaf.chunks[2 * i];
        pairs[i][1] = chunked_leaf.chunks[2 * i + 1];
    }
    var ref_root: [32]u8 = undefined;
    try hashing.merkleize(pairs, k_log2, &ref_root);

    try std.testing.expectEqualSlices(u8, &ref_root, &chunked_leaf_root);
}

test "Pool.createChunkedLeaf: round-trips chunks via getChunkedLeafChunks/getChunkedLeafLen" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();

    var src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    src[0][0] = 0xAB;
    src[K - 1][31] = 0xCD;

    const chunked_leaf_id = try pool.createChunkedLeaf(&src, K);
    defer pool.unref(chunked_leaf_id);

    const got = try chunked_leaf_id.getChunkedLeafChunks(&pool);
    try std.testing.expectEqual(@as(u8, 0xAB), got[0][0]);
    try std.testing.expectEqual(@as(u8, 0xCD), got[K - 1][31]);
    try std.testing.expectEqual(@as(u16, K), try chunked_leaf_id.getChunkedLeafLen(&pool));
}

test "Pool.unref: chunked_leaf payload heap is freed (no leak under test allocator)" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();

    const src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    const chunked_leaf_id = try pool.createChunkedLeaf(&src, K);
    pool.unref(chunked_leaf_id);
}

test "Id.getRoot: Pool-created chunked_leaf returns merkleized root and caches it" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();

    var src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    for (0..K) |i| {
        std.mem.writeInt(u256, &src[i], @as(u256, @intCast(i + 1)), .little);
    }

    const chunked_leaf_id = try pool.createChunkedLeaf(&src, K);
    defer pool.unref(chunked_leaf_id);

    const root_first = chunked_leaf_id.getRoot(&pool);

    var ref: [32]u8 = undefined;
    var pairs = try allocator.alloc([2][32]u8, K / 2);
    defer allocator.free(pairs);
    for (0..K / 2) |i| {
        pairs[i][0] = src[2 * i];
        pairs[i][1] = src[2 * i + 1];
    }
    try hashing.merkleize(pairs, k_log2, &ref);
    try std.testing.expectEqualSlices(u8, &ref, root_first);

    const root_second = chunked_leaf_id.getRoot(&pool);
    try std.testing.expectEqualSlices(u8, root_first, root_second);
}

test "Id.setChunkedLeafChunk: CoW one chunk; original unchanged; root differs" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();

    var src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    src[42][0] = 0x11;
    const a = try pool.createChunkedLeaf(&src, K);
    defer pool.unref(a);

    var new_chunk: [32]u8 = [_]u8{0} ** 32;
    new_chunk[0] = 0x22;
    const b = try a.setChunkedLeafChunk(&pool, 42, &new_chunk);
    defer pool.unref(b);

    try std.testing.expect(a != b);

    const a_chunks = try a.getChunkedLeafChunks(&pool);
    const b_chunks = try b.getChunkedLeafChunks(&pool);
    try std.testing.expectEqual(@as(u8, 0x11), a_chunks[42][0]);
    try std.testing.expectEqual(@as(u8, 0x22), b_chunks[42][0]);

    try std.testing.expectEqualSlices(u8, &a_chunks[0], &b_chunks[0]);
    try std.testing.expectEqualSlices(u8, &a_chunks[K - 1], &b_chunks[K - 1]);

    try std.testing.expect(!std.mem.eql(u8, a.getRoot(&pool), b.getRoot(&pool)));
}

test "Id.setChunkedLeafChunk: preserves len" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();

    const src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    const test_len: u16 = K - 1;
    const a = try pool.createChunkedLeaf(&src, test_len);
    defer pool.unref(a);

    var new_chunk: [32]u8 = [_]u8{0xFF} ** 32;
    const b = try a.setChunkedLeafChunk(&pool, K / 4, &new_chunk);
    defer pool.unref(b);

    try std.testing.expectEqual(test_len, try b.getChunkedLeafLen(&pool));
}

test "Id.setChunkedLeafChunks: batch CoW with multiple updates" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();

    const src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    const a = try pool.createChunkedLeaf(&src, K);
    defer pool.unref(a);

    const idxs = [_]u16{ 0, 7, K / 2, K - 1 };
    const c0 = [_]u8{0xAA} ** 32;
    const c1 = [_]u8{0xBB} ** 32;
    const c2 = [_]u8{0xCC} ** 32;
    const c3 = [_]u8{0xDD} ** 32;
    const ptrs = [_]*const [32]u8{ &c0, &c1, &c2, &c3 };

    const b = try a.setChunkedLeafChunks(&pool, &idxs, &ptrs);
    defer pool.unref(b);

    const got = try b.getChunkedLeafChunks(&pool);
    try std.testing.expectEqual(@as(u8, 0xAA), got[idxs[0]][0]);
    try std.testing.expectEqual(@as(u8, 0xBB), got[idxs[1]][0]);
    try std.testing.expectEqual(@as(u8, 0xCC), got[idxs[2]][0]);
    try std.testing.expectEqual(@as(u8, 0xDD), got[idxs[3]][0]);

    const a_chunks = try a.getChunkedLeafChunks(&pool);
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 32), &a_chunks[0]);
}

test "Id.setChunkedLeafChunks: empty batch produces a clone with empty dirty" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();

    const src: [K][32]u8 align(64) = [_][32]u8{[_]u8{0} ** 32} ** K;
    const a = try pool.createChunkedLeaf(&src, K);
    defer pool.unref(a);

    const idxs: []const u16 = &.{};
    const ptrs: []const *const [32]u8 = &.{};
    const b = try a.setChunkedLeafChunks(&pool, idxs, ptrs);
    defer pool.unref(b);

    try std.testing.expect(a != b);
    try std.testing.expectEqualSlices(u8, a.getRoot(&pool), b.getRoot(&pool));
}

test "Id.setChunkedLeafChunk: non-chunked_leaf Id returns error.InvalidNode" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();

    const leaf_id = try pool.createLeaf(&([_]u8{0xEE} ** 32));
    defer pool.unref(leaf_id);

    var new_chunk: [32]u8 = [_]u8{0xFF} ** 32;
    try std.testing.expectError(error.InvalidNode, leaf_id.setChunkedLeafChunk(&pool, 0, &new_chunk));
}

test "tree of chunked leaves: build via SubtreeBuilder; root matches per-leaf tree" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1 << 14 });
    defer pool.deinit();

    var raw: [4][K][32]u8 align(64) = undefined;
    @memset(std.mem.asBytes(&raw), 0);
    for (0..4) |s| for (0..K) |i| {
        std.mem.writeInt(u256, &raw[s][i], @as(u256, @intCast(s * K + i + 1)), .little);
    };

    var chunked_leaf_it = Node.SubtreeBuilder.init(&pool, 2);
    errdefer chunked_leaf_it.deinit();
    for (0..4) |s| {
        const sid = try pool.createChunkedLeaf(&raw[s], K);
        try chunked_leaf_it.append(sid);
    }
    const chunked_leaf_root_id = try chunked_leaf_it.finish();
    defer pool.unref(chunked_leaf_root_id);

    var leaf_it = Node.SubtreeBuilder.init(&pool, k_log2 + 2);
    errdefer leaf_it.deinit();
    for (0..4) |s| for (0..K) |i| {
        var c = raw[s][i];
        try leaf_it.append(try pool.createLeaf(&c));
    };
    const leaf_root_id = try leaf_it.finish();
    defer pool.unref(leaf_root_id);

    try std.testing.expectEqualSlices(u8, chunked_leaf_root_id.getRoot(&pool), leaf_root_id.getRoot(&pool));
}

test "SubtreeBuilder: initWithOffset enables chunked_leaf leaves with correct zero filler" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1 << 14 });
    defer pool.deinit();

    var raw: [4][K][32]u8 align(64) = undefined;
    @memset(std.mem.asBytes(&raw), 0);
    for (0..4) |s| for (0..K) |i| {
        std.mem.writeInt(u256, &raw[s][i], @as(u256, @intCast(s * K + i + 1)), .little);
    };

    var chunked_leaf_it = Node.SubtreeBuilder.initWithOffset(&pool, 2, k_log2);
    errdefer chunked_leaf_it.deinit();
    for (0..4) |s| {
        const sid = try pool.createChunkedLeaf(&raw[s], K);
        try chunked_leaf_it.append(sid);
    }
    const chunked_leaf_root_id = try chunked_leaf_it.finish();
    defer pool.unref(chunked_leaf_root_id);

    var leaf_it = Node.SubtreeBuilder.init(&pool, k_log2 + 2);
    errdefer leaf_it.deinit();
    for (0..4) |s| for (0..K) |i| {
        var c = raw[s][i];
        try leaf_it.append(try pool.createLeaf(&c));
    };
    const leaf_root_id = try leaf_it.finish();
    defer pool.unref(leaf_root_id);

    try std.testing.expectEqualSlices(u8, chunked_leaf_root_id.getRoot(&pool), leaf_root_id.getRoot(&pool));
}

test "SubtreeBuilder: initWithOffset with partial fill (zero-padded chunked leaves)" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1 << 14 });
    defer pool.deinit();

    var raw: [3][K][32]u8 align(64) = undefined;
    @memset(std.mem.asBytes(&raw), 0);
    for (0..3) |s| for (0..K) |i| {
        std.mem.writeInt(u256, &raw[s][i], @as(u256, @intCast(s * K + i + 1)), .little);
    };

    var chunked_leaf_it = Node.SubtreeBuilder.initWithOffset(&pool, 2, k_log2);
    errdefer chunked_leaf_it.deinit();
    for (0..3) |s| {
        const sid = try pool.createChunkedLeaf(&raw[s], K);
        try chunked_leaf_it.append(sid);
    }
    const chunked_leaf_root_id = try chunked_leaf_it.finish();
    defer pool.unref(chunked_leaf_root_id);

    var leaf_it = Node.SubtreeBuilder.init(&pool, k_log2 + 2);
    errdefer leaf_it.deinit();
    for (0..3) |s| for (0..K) |i| {
        var c = raw[s][i];
        try leaf_it.append(try pool.createLeaf(&c));
    };
    const leaf_root_id = try leaf_it.finish();
    defer pool.unref(leaf_root_id);

    try std.testing.expectEqualSlices(u8, chunked_leaf_root_id.getRoot(&pool), leaf_root_id.getRoot(&pool));
}
