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

test "a proof reveals the secret of its slot, and its branch holds leaves that commit to secrets" {
    const Keccak256 = std.crypto.hash.sha3.Keccak256;
    const seed: vrf_tree.Seed = @splat(5);
    var tree = try VrfTree.init(std.testing.allocator, &seed, 4, null, 1);
    defer tree.deinit();
    const proof = try tree.proof(7);

    var secret: [32]u8 = undefined;
    Keccak256.hash("VRF_SECRET" ++ seed ++ [8]u8{ 7, 0, 0, 0, 0, 0, 0, 0 }, &secret, .{});
    try std.testing.expectEqualSlices(u8, &secret, &proof[0]);

    // The first sibling is the leaf of slot 6
    var sibling_secret: [32]u8 = undefined;
    Keccak256.hash("VRF_SECRET" ++ seed ++ [8]u8{ 6, 0, 0, 0, 0, 0, 0, 0 }, &sibling_secret, .{});
    var sibling_leaf: [32]u8 = undefined;
    Keccak256.hash("VRF_LEAF" ++ sibling_secret ++ [8]u8{ 6, 0, 0, 0, 0, 0, 0, 0 }, &sibling_leaf, .{});
    try std.testing.expectEqualSlices(u8, &sibling_leaf, &proof[1]);
}

// Validator 0 of the default ethereum-package mnemonic at the pq-devnet-1 genesis: its VRF seed,
// and its record, the first of the `.vrf` file of ethPandaOps (sha256 9bf10368...)
test "a tree with its first 2^20 leaves and the rest from its record has the devnet genesis root" {
    var seed: vrf_tree.Seed = undefined;
    _ = try std.fmt.hexToBytes(&seed, "543fc5a4d86e79a434e9741770f7ee17c25bdc31be8d61436d7f9836538b03df");
    const record_fields = [_][]const u8{
        "75d1866ec07565ce2f2e3d0e368fe0193f868f326f5c469698c4a6e1e70575a7",
        "00000000",
        "60961f9391410c89b136d976b68d1c6818c1fce2f5189e2d7dbad4b4b31b73d2",
        "2ac052c66618d2ca42ebfc6ad75444fea145568f2122db1d8ffb0a4a695410ed",
        "166656b737c86c06c36c9c55eb6b33553906aaad921f4febf8531f4fe7f98220",
        "652712965eb130d84e4e4a08487f6d5a499ed354ba18db632ffc6ba3373508d3",
        "a057559422d634ecd1f3ea3b2e034e79e73db6bf2fb4f82e1076a87b958bc054",
        "92e9f590536597edb0cfdb1638f928e68f652fd152c93a2fec73641dd7ade527",
        "fcd582dc7e6b9bc9ed3158df565b883645c40848e9ae84642429991fa03e92e7",
        "6f70e5521c89b8832e6f8b2018415446b489692218c1518fee68cfa763ed5fbf",
        "315bc4f7592ae23a219f156a42affeb7d786c87fbd2f31351923c7d4e043c1ea",
        "f1ec67f4445dbf61911cbab41558da9663d234d9f77cf20884a2fe3c089f58dc",
        "eb52bb222dfdfe96d809739c5f7d9716fbd9e065f17d4bc8c1346483a9baff3b",
        "acb9bb28173c7d090417f773e71459d644ef951b7f47d0f8e0a68efeca23a7d9",
        "98744397ee0c4581d7ac58717851eb009dc58e234c36f23d175785b5c3b9dc0c",
        "0a3ab28aecc71296499a7447957a1dbf36de680aeff05eaf917ac77594ae109f",
        "e6fe08270185e89fe39b08a22354b16021a43086a458ab0df023813e261ccc70",
        "93a1124d53b41d355daf763be641f6f2785f549a1e9bda822785288550ea462d",
        "c23daebc0593b48de80a5460356edb3fb18e13ed68a2047dd7b125775e316e41",
        "706b330d1cbb4b538af0677b7559bac7cfeb4500dfa3eec0092d162e6b420828",
        "7bfa822fd12d715cc63754b628b6c9f8009f02269aa8802a9706968ef67bd679",
        "81d5da9733aacff486fbb6496d80df721beb2bbab8865461c197c685c62cbde3",
        "46386632eaeef21168ec0c5d9903a2230e4dcf65937d206cd4af34ba09bc2c34",
        "aa9f0181ab56e376883f2b54cb9b9b936fef369063574da4db74a7777fd9cbf9",
        "3276c74b9dcbe2e137b58e96ee127c6fb2853b2f644394e2944e2347c6cf4c69",
        "ab1b1ecada4971322ee6099d8ea9030b0e38b5a6b1e6f0027ac0ecd98a8cbdba",
        "446d941faa412f0418b74cbdd05504164231b55a0b67ca604c9240e6a69c3894",
        "bcc260fc1c13b8894e9174a5d6e694df79fbda97d0b62ac880b92353de0edb95",
        "1b8e0a58439148e95ad661d98b259ae6a4d82e72f25e58354b8bc43e4745021c",
        "8fb4faa40822d3e4b449322eed3c51c3ae855f6ed915b0b8429a061fc755ce37",
        "12601a539f32b1e0c338b4db274a153526a7fb5c679f9ba6b4335bb692c9e49d",
        "5a56b174ccd3cdc9249196c31edc4ca29266434a5c7d965ae62bea4db9c61f24",
        "502b4f387e8f70dff47cc45d63b467a15588d541198698288299be769c02d0ad",
    };
    var record: [vrf_tree.state_record_size]u8 = undefined;
    var offset: usize = 0;
    for (record_fields) |field| offset += (try std.fmt.hexToBytes(record[offset..], field)).len;
    try std.testing.expectEqual(record.len, offset);

    try std.testing.expectEqual(@as([*]const u8, &record), @as([*]const u8, vrf_tree.findState(&seed, &record).?));
    var tree = try VrfTree.init(std.testing.allocator, &seed, 20, &record, 4);
    defer tree.deinit();
    try std.testing.expectEqualSlices(u8, record[0..32], &tree.root());
    for ([_]u64{ 0, 12_345, (1 << 20) - 1 }) |slot| {
        try std.testing.expect(vrf_tree.isValidProof(&tree.root(), slot, &(try tree.proof(slot))));
    }
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

test "a tree comes back from its subtree roots without hashing a leaf" {
    const seed: vrf_tree.Seed = @splat(6);
    var full = try VrfTree.init(std.testing.allocator, &seed, 18, null, 4);
    defer full.deinit();
    var record: [vrf_tree.state_record_size]u8 = @splat(0);
    record[0..32].* = full.root();
    @memcpy(record[36..], std.mem.asBytes((try full.proof(0))[1..]));

    var built = try VrfTree.init(std.testing.allocator, &seed, 17, &record, 4);
    defer built.deinit();
    const roots = built.subtreeRoots();
    try std.testing.expectEqual(2, roots.len);

    var loaded = try VrfTree.initFromSubtreeRoots(std.testing.allocator, &seed, 17, &record, roots);
    defer loaded.deinit();
    try std.testing.expectEqualSlices(u8, &built.root(), &loaded.root());
    for ([_]u64{ 0, 65_535, 70_000 }) |slot| {
        try std.testing.expectEqualSlices(u8, std.mem.asBytes(&(try built.proof(slot))), std.mem.asBytes(&(try loaded.proof(slot))));
    }

    var without_record = try VrfTree.initFromSubtreeRoots(std.testing.allocator, &seed, 17, null, roots);
    defer without_record.deinit();
    var built_without_record = try VrfTree.init(std.testing.allocator, &seed, 17, null, 4);
    defer built_without_record.deinit();
    try std.testing.expectEqualSlices(u8, &built_without_record.root(), &without_record.root());

    var small = try VrfTree.init(std.testing.allocator, &seed, 4, null, 1);
    defer small.deinit();
    try std.testing.expectEqual(1, small.subtreeRoots().len);

    // Roots of another tree, or too few, do not make this one
    var other = try VrfTree.init(std.testing.allocator, &@as(vrf_tree.Seed, @splat(7)), 17, null, 4);
    defer other.deinit();
    try std.testing.expectError(
        error.NoMatchingState,
        VrfTree.initFromSubtreeRoots(std.testing.allocator, &seed, 17, &record, other.subtreeRoots()),
    );
    try std.testing.expectError(
        error.InvalidSubtreeRoots,
        VrfTree.initFromSubtreeRoots(std.testing.allocator, &seed, 17, &record, roots[0..1]),
    );
    try std.testing.expectError(
        error.InvalidSubtreeRoots,
        VrfTree.initFromSubtreeRoots(std.testing.allocator, &seed, 17, null, &.{}),
    );
}
