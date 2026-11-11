const std = @import("std");
const hashing = @import("hashing");
const vrf_tree = @import("root.zig");
const VrfTree = vrf_tree.VrfTree;

fn rootOf(proof: *const vrf_tree.Proof, slot: u64) [32]u8 {
    var value = proof[0];
    for (proof[1..], 0..) |*sibling, level| {
        if ((slot >> @intCast(level)) & 1 == 1) {
            hashing.hashOne(&value, sibling, &value);
        } else {
            hashing.hashOne(&value, &value, sibling);
        }
    }
    return value;
}

test "proofs open to the root" {
    const seed: vrf_tree.Seed = @splat(3);
    var tree = try VrfTree.init(std.testing.allocator, &seed, 18, 4);
    defer tree.deinit();

    const root = tree.root();
    var seen: [4][32]u8 = undefined;
    for ([_]u64{ 0, 1, 65_535, 65_536, (1 << 18) - 1 }, 0..) |slot, i| {
        const proof = try tree.proof(slot);
        try std.testing.expectEqualSlices(u8, &root, &rootOf(&proof, slot));
        if (i < seen.len) seen[i] = proof[0];
    }
    try std.testing.expect(!std.mem.eql(u8, &seen[0], &seen[1]));
    try std.testing.expectError(error.SlotNotPopulated, tree.proof(1 << 18));
}

test "a tree is a function of its seed and does not depend on the thread count" {
    const seed: vrf_tree.Seed = @splat(9);
    var one = try VrfTree.init(std.testing.allocator, &seed, 17, 1);
    defer one.deinit();
    var many = try VrfTree.init(std.testing.allocator, &seed, 17, 8);
    defer many.deinit();
    try std.testing.expectEqualSlices(u8, &one.root(), &many.root());

    var other = try VrfTree.init(std.testing.allocator, &@as(vrf_tree.Seed, @splat(10)), 17, 1);
    defer other.deinit();
    try std.testing.expect(!std.mem.eql(u8, &one.root(), &other.root()));
}

test "a tree with fewer leaves than a subtree" {
    const seed: vrf_tree.Seed = @splat(1);
    var tree = try VrfTree.init(std.testing.allocator, &seed, 4, 2);
    defer tree.deinit();
    const proof = try tree.proof(15);
    try std.testing.expectEqualSlices(u8, &tree.root(), &rootOf(&proof, 15));
    try std.testing.expectError(error.SlotNotPopulated, tree.proof(16));
}
