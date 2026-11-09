//! Tests for `verify_merkle_branch.zig`.

const std = @import("std");
const types = @import("consensus_types");
const Sha256 = std.crypto.hash.sha2.Sha256;
const Root = types.primitive.Root.Type;
const verifyMerkleBranch = @import("verify_merkle_branch.zig").verifyMerkleBranch;

/// Build a simple Merkle root from leaf values by hashing pairs bottom-up.
fn computeMerkleRoot(leaves: []const Root) Root {
    const depth = std.math.log2_int_ceil(usize, if (leaves.len <= 1) 2 else leaves.len);
    const width = @as(usize, 1) << @intCast(depth);
    var layer: [64]Root = undefined; // supports up to 64 leaves
    const zero: Root = .{0} ** 32;

    // Fill leaves + padding
    for (0..width) |i| {
        layer[i] = if (i < leaves.len) leaves[i] else zero;
    }

    var current_width = width;
    while (current_width > 1) {
        const half = current_width / 2;
        for (0..half) |i| {
            var tmp: [64]u8 = undefined;
            @memcpy(tmp[0..32], &layer[2 * i]);
            @memcpy(tmp[32..], &layer[2 * i + 1]);
            Sha256.hash(&tmp, &layer[i], .{});
        }
        current_width = half;
    }
    return layer[0];
}

/// Extract a Merkle proof for a given leaf index from a set of leaves.
fn computeMerkleProof(leaves: []const Root, index: usize, depth: usize) [33]Root {
    const width = @as(usize, 1) << @intCast(depth);
    var layers: [7][64]Root = undefined; // supports depth up to 6
    const zero: Root = .{0} ** 32;

    // Layer 0: leaves
    for (0..width) |i| {
        layers[0][i] = if (i < leaves.len) leaves[i] else zero;
    }

    // Build layers bottom-up
    for (1..depth + 1) |d| {
        const prev_width = @as(usize, 1) << @intCast(depth - d + 1);
        const half = prev_width / 2;
        for (0..half) |i| {
            var tmp: [64]u8 = undefined;
            @memcpy(tmp[0..32], &layers[d - 1][2 * i]);
            @memcpy(tmp[32..], &layers[d - 1][2 * i + 1]);
            Sha256.hash(&tmp, &layers[d][i], .{});
        }
    }

    // Extract proof: sibling at each level
    var proof: [33]Root = .{zero} ** 33;
    var idx = index;
    for (0..depth) |d| {
        const sibling = if (idx % 2 == 0) idx + 1 else idx - 1;
        proof[d] = layers[d][sibling];
        idx /= 2;
    }
    return proof;
}

test "verify valid merkle branch - depth 1" {
    const zero: Root = .{0} ** 32;
    var leaf0: Root = undefined;
    @memset(&leaf0, 0xAA);
    var leaf1: Root = undefined;
    @memset(&leaf1, 0xBB);

    const leaves = [_]Root{ leaf0, leaf1 };
    const root = computeMerkleRoot(&leaves);
    const proof0 = computeMerkleProof(&leaves, 0, 1);
    const proof1 = computeMerkleProof(&leaves, 1, 1);

    // Verify leaf at index 0.
    try std.testing.expect(verifyMerkleBranch(leaf0, &proof0, 1, 0, root));
    // Verify leaf at index 1.
    try std.testing.expect(verifyMerkleBranch(leaf1, &proof1, 1, 1, root));
    // Wrong leaf should fail.
    try std.testing.expect(!verifyMerkleBranch(leaf1, &proof0, 1, 0, root));
    // Zero leaf with correct proof should fail.
    try std.testing.expect(!verifyMerkleBranch(zero, &proof0, 1, 0, root));
}

test "verify valid merkle branch - depth 2" {
    var leaves: [4]Root = undefined;
    for (&leaves, 0..) |*leaf, i| {
        @memset(leaf, @intCast(i + 1));
    }

    const root = computeMerkleRoot(&leaves);

    for (0..4) |i| {
        const proof = computeMerkleProof(&leaves, i, 2);
        try std.testing.expect(verifyMerkleBranch(leaves[i], &proof, 2, i, root));
    }
}

test "verify valid merkle branch - depth 3" {
    var leaves: [8]Root = undefined;
    for (&leaves, 0..) |*leaf, i| {
        @memset(leaf, @intCast(i + 0x10));
    }

    const root = computeMerkleRoot(&leaves);

    for (0..8) |i| {
        const proof = computeMerkleProof(&leaves, i, 3);
        try std.testing.expect(verifyMerkleBranch(leaves[i], &proof, 3, i, root));
    }
}

test "verify fails with wrong root" {
    var leaves: [4]Root = undefined;
    for (&leaves, 0..) |*leaf, i| {
        @memset(leaf, @intCast(i + 1));
    }

    var wrong_root: Root = undefined;
    @memset(&wrong_root, 0xFF);

    const proof = computeMerkleProof(&leaves, 0, 2);
    try std.testing.expect(!verifyMerkleBranch(leaves[0], &proof, 2, 0, wrong_root));
}

test "verify fails with wrong index" {
    var leaves: [4]Root = undefined;
    for (&leaves, 0..) |*leaf, i| {
        @memset(leaf, @intCast(i + 1));
    }

    const root = computeMerkleRoot(&leaves);
    const proof = computeMerkleProof(&leaves, 0, 2);

    // Proof for index 0 should fail at index 1.
    try std.testing.expect(!verifyMerkleBranch(leaves[0], &proof, 2, 1, root));
}

test "verify with all-zero leaves at depth 0" {
    const zero: Root = .{0} ** 32;
    var proof: [33]Root = .{zero} ** 33;
    // At depth 0, the leaf IS the root (no hashing).
    try std.testing.expect(verifyMerkleBranch(zero, &proof, 0, 0, zero));

    // Non-zero leaf at depth 0 should match itself.
    var leaf: Root = undefined;
    @memset(&leaf, 0x42);
    try std.testing.expect(verifyMerkleBranch(leaf, &proof, 0, 0, leaf));
}
