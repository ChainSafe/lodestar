const std = @import("std");
const vrf_tree = @import("root.zig");
const VrfTree = vrf_tree.VrfTree;

test "proofs open to the root" {
    const seed: vrf_tree.Seed = @splat(3);
    var tree = try VrfTree.init(std.testing.allocator, &seed, 18, null, 4);
    defer tree.deinit();

    const root = tree.root();
    var seen: [4][32]u8 = undefined;
    for ([_]u64{ 0, 1, 65_535, 65_536, (1 << 18) - 1 }, 0..) |slot, i| {
        const proof = try tree.proof(slot);
        try std.testing.expect(vrf_tree.isValidProof(&root, slot, &proof));
        try std.testing.expect(!vrf_tree.isValidProof(&root, slot ^ 1, &proof));
        if (i < seen.len) seen[i] = proof[0];
    }
    try std.testing.expect(!std.mem.eql(u8, &seen[0], &seen[1]));
    try std.testing.expectError(error.SlotNotPopulated, tree.proof(1 << 18));
}

test "a tree is a function of its seed and does not depend on the thread count" {
    const seed: vrf_tree.Seed = @splat(9);
    var one = try VrfTree.init(std.testing.allocator, &seed, 17, null, 1);
    defer one.deinit();
    var many = try VrfTree.init(std.testing.allocator, &seed, 17, null, 8);
    defer many.deinit();
    try std.testing.expectEqualSlices(u8, &one.root(), &many.root());

    var other = try VrfTree.init(std.testing.allocator, &@as(vrf_tree.Seed, @splat(10)), 17, null, 1);
    defer other.deinit();
    try std.testing.expect(!std.mem.eql(u8, &one.root(), &other.root()));
}

test "a leaf is the Keccak-256 hash of the seed and its slot" {
    const seed: vrf_tree.Seed = @splat(5);
    var tree = try VrfTree.init(std.testing.allocator, &seed, 4, null, 1);
    defer tree.deinit();
    var expected: [32]u8 = undefined;
    std.crypto.hash.sha3.Keccak256.hash(&(seed ++ [8]u8{ 7, 0, 0, 0, 0, 0, 0, 0 }), &expected, .{});
    try std.testing.expectEqualSlices(u8, &expected, &(try tree.proof(7))[0]);
}

test "the root of a tree with its first 2^20 leaves filled, as leanVM and the genesis tooling give it" {
    var seed: vrf_tree.Seed = undefined;
    _ = try std.fmt.hexToBytes(&seed, "8b6fe7f8e9b2a6e0ebf8fd5a7b3991329affcd3ff91aec159d33e4b4dedac940");
    var tree = try VrfTree.init(std.testing.allocator, &seed, 20, null, 4);
    defer tree.deinit();
    var expected: vrf_tree.Root = undefined;
    _ = try std.fmt.hexToBytes(&expected, "46f6772a35c14c7f8467e9d8791450ed3c6853191129876fc50e769ec9bac18d");
    try std.testing.expectEqualSlices(u8, &expected, &tree.root());
}

test "a tree takes what stands above its first slots from a record" {
    const seed: vrf_tree.Seed = @splat(6);
    // The whole of a shallow tree stands in for a full one, which takes minutes
    var full = try VrfTree.init(std.testing.allocator, &seed, 18, null, 4);
    defer full.deinit();
    var other = try VrfTree.init(std.testing.allocator, &@as(vrf_tree.Seed, @splat(7)), 18, null, 4);
    defer other.deinit();

    var records: [2 * vrf_tree.state_record_size]u8 = @splat(0);
    for ([_]*VrfTree{ &other, &full }, 0..) |tree, i| {
        const record = records[i * vrf_tree.state_record_size ..][0..vrf_tree.state_record_size];
        record[0..32].* = tree.root();
        @memcpy(record[36..], std.mem.asBytes((try tree.proof(0))[1..]));
    }

    var partial = try VrfTree.init(std.testing.allocator, &seed, 17, &records, 4);
    defer partial.deinit();
    try std.testing.expectEqualSlices(u8, &full.root(), &partial.root());
    try std.testing.expectEqualSlices(u8, std.mem.asBytes(&(try full.proof(70_000))), std.mem.asBytes(&(try partial.proof(70_000))));
    try std.testing.expectError(error.SlotNotPopulated, partial.proof(1 << 17));

    try std.testing.expectEqual(records[vrf_tree.state_record_size..].ptr, @as([*]const u8, vrf_tree.findState(&seed, &records).?));
    try std.testing.expectEqual(null, vrf_tree.findState(&seed, records[0..vrf_tree.state_record_size]));
    try std.testing.expectError(
        error.NoMatchingState,
        VrfTree.init(std.testing.allocator, &seed, 17, records[0..vrf_tree.state_record_size], 4),
    );
}

test "a tree with fewer leaves than a subtree" {
    const seed: vrf_tree.Seed = @splat(1);
    var tree = try VrfTree.init(std.testing.allocator, &seed, 4, null, 2);
    defer tree.deinit();
    const proof = try tree.proof(15);
    try std.testing.expect(vrf_tree.isValidProof(&tree.root(), 15, &proof));
    try std.testing.expectError(error.SlotNotPopulated, tree.proof(16));
}
