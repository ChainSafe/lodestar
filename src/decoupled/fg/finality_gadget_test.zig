const std = @import("std");
const testing = std.testing;
const FG = @import("FinalityGadget.zig");
const fg = @import("finality_types.zig");
const Frame = @import("FinalityFrame.zig");
const SigningRecord = @import("SigningRecord.zig");
const limits = @import("../limits.zig");

// Test roots stand in for content digests already checked at Node's ingress boundary.
// Summaries stand in for the state transition, which StateSource tests exercise end to end.
const config: FG.Config = .{ .B_gen = @splat(0) };
fn root(n: u32) fg.Root {
    var result: fg.Root = @splat(0);
    std.mem.writeInt(u32, result[0..4], n, .little);
    return result;
}
fn ref(id: u32, slot: u32) fg.BlockRef {
    return .{ .root = root(id), .slot = slot };
}
fn create() !*FG {
    const Sigma = try testing.allocator.create(FG);
    Sigma.init(&config);
    return Sigma;
}
const Summary = struct { h: u32, T_h: fg.BlockRef, h_j: u32 = 0, J: fg.BlockRef = ref(0, 0), h_F: u32 = 0, F: fg.BlockRef = ref(0, 0) };
fn add(Sigma: *FG, id: u32, slot: u32, parent: u32, summary: Summary) !void {
    const B: fg.Block = .{ .root = root(id), .slot = slot, .parent = root(parent), .proposer = 0 };
    try testing.expect(try Sigma.onBlock(&B, &.{
        .h = summary.h,
        .T_h = summary.T_h,
        .h_j = summary.h_j,
        .J = summary.J,
        .h_F = summary.h_F,
        .F = summary.F,
    }));
}
fn expectSame(a: *const FG, b: *const FG) !void {
    try testing.expectEqualDeep(a.config, b.config);
    try testing.expectEqualDeep(a.F, b.F);
    try testing.expectEqualDeep(a.J, b.J);
    try testing.expectEqual(a.h_j, b.h_j);
    try testing.expectEqual(a.h_max, b.h_max);
    try testing.expectEqual(a.T.count, b.T.count);
    for (a.T.constSlice(), b.T.constSlice(), 0..) |*left, *right, i| {
        inline for (.{ "root", "slot", "parent", "proposer" }) |field| {
            try testing.expectEqualDeep(@field(left, field), @field(right, field));
        }
        try testing.expectEqualDeep(left.attestations.constSlice(), right.attestations.constSlice());
        try testing.expectEqualDeep(
            left.ac_payload.votes.constSlice(),
            right.ac_payload.votes.constSlice(),
        );
        try testing.expectEqualDeep(
            left.ac_payload.support_votes.constSlice(),
            right.ac_payload.support_votes.constSlice(),
        );
        try testing.expectEqualDeep(a.summaries[i], b.summaries[i]);
    }
}

test "genesis initializes Sigma and supplies a real FG frame" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    try testing.expectEqual(@as(u32, 1), Sigma.T.count);
    try testing.expectEqual(@as(u32, 1), Sigma.h_max);
    try testing.expectEqual(@as(u32, 0), Sigma.h_j);
    try testing.expectEqual(@as(u32, 1), Sigma.summaries[0].h);
    try testing.expect(Sigma.summaries[0].valid());
    try testing.expect(!Sigma.fgContest());
    try testing.expectEqual(@as(u32, 0), Sigma.headHeightFloor());
    var buffer: FG.FrameBuffer = undefined;
    const Phi = try Sigma.toAC(&buffer);
    try testing.expectEqual(@as(usize, 1), Phi.tree.len);
    try testing.expectEqual(root(0), Phi.fc_root);
    try testing.expect(Phi.viable_heads[0]);
}

test "summaries justify and finalize while Sigma retains every block" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    try add(Sigma, 1, 1, 0, .{ .h = 2, .T_h = ref(1, 1), .h_j = 1, .J = ref(0, 0) });
    try add(Sigma, 2, 2, 1, .{ .h = 3, .T_h = ref(2, 2), .h_j = 2, .J = ref(1, 1) });
    try add(Sigma, 3, 3, 2, .{ .h = 4, .T_h = ref(3, 3), .h_j = 3, .J = ref(2, 2), .h_F = 1, .F = ref(1, 1) });
    try testing.expectEqual(root(1), Sigma.F.root);
    try testing.expectEqual(root(2), Sigma.J.root);
    try testing.expectEqual(@as(u32, 3), Sigma.h_j);
    try testing.expectEqual(@as(u32, 4), Sigma.h_max);
    try testing.expectEqual(@as(u32, 4), Sigma.T.count);
    var buffer: FG.FrameBuffer = undefined;
    const Phi = try Sigma.toAC(&buffer);
    try testing.expectEqual(root(1), Phi.tree[0].root);
    try testing.expectEqual(root(2), Phi.fc_root);
    try testing.expect(!Phi.viable_heads[0]);
    try testing.expect(Phi.viable_heads[1] and Phi.viable_heads[2]);
    const outside: fg.Block = .{ .root = root(9), .parent = root(0), .slot = 4, .proposer = 0 };
    try testing.expect(!Sigma.canAccept(&outside));
    try testing.expect(!try Sigma.onBlock(&outside, &Sigma.summaries[0]));
    try testing.expectEqual(@as(u32, 4), Sigma.T.count);
}

test "frontier contests inspect all accepted branches and choose J lexicographically" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    try add(Sigma, 1, 1, 0, .{ .h = 2, .T_h = ref(1, 1), .h_j = 1, .J = ref(0, 0) });
    try add(Sigma, 2, 1, 0, .{ .h = 2, .T_h = ref(2, 1), .h_j = 1, .J = ref(0, 0) });
    try add(Sigma, 3, 2, 1, .{ .h = 3, .T_h = ref(3, 2), .h_j = 2, .J = ref(1, 1) });
    try testing.expectEqual(root(1), Sigma.getFCRoot().root);
    try testing.expect(!Sigma.fgContest());
    try add(Sigma, 4, 2, 2, .{ .h = 3, .T_h = ref(4, 2), .h_j = 2, .J = ref(2, 1) });
    try testing.expectEqual(root(2), Sigma.J.root);
    try testing.expect(Sigma.fgContest());
    try testing.expectEqual(root(0), Sigma.getFCRoot().root);
    try testing.expectEqual(@as(u32, 3), Sigma.headHeightFloor());
    var buffer: FG.FrameBuffer = undefined;
    const Phi = try Sigma.toAC(&buffer);
    try testing.expect(!Phi.viable_heads[1] and !Phi.viable_heads[2]);
    try testing.expect(Phi.viable_heads[3] and Phi.viable_heads[4]);
    try add(Sigma, 5, 4, 4, .{ .h = 4, .T_h = ref(5, 4), .h_j = 2, .J = ref(2, 1) });
    try testing.expectEqual(@as(u32, 4), Sigma.h_max);
    try testing.expect(!Sigma.fgContest());
    try testing.expectEqual(root(0), Sigma.getFCRoot().root);
    try testing.expectEqual(@as(u32, 3), Sigma.headHeightFloor());
}

test "finalization waits for a viable descendant before accepting the same root" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    var parent: u32 = 0;
    for (1..6) |height| {
        const id: u32 = @intCast(100 + height);
        const slot: u32 = @intCast(2 * height);
        try add(Sigma, id, slot, parent, .{ .h = @intCast(height + 1), .T_h = ref(id, slot) });
        parent = id;
    }
    try testing.expectEqual(@as(u32, 6), Sigma.h_max);
    try add(Sigma, 1, 1, 0, .{ .h = 2, .T_h = ref(1, 1), .h_j = 1, .J = ref(0, 0) });
    try add(Sigma, 2, 2, 1, .{ .h = 3, .T_h = ref(2, 2), .h_j = 2, .J = ref(1, 1) });
    try add(Sigma, 3, 3, 2, .{ .h = 4, .T_h = ref(3, 3), .h_j = 3, .J = ref(2, 2), .h_F = 1, .F = ref(1, 1) });
    try testing.expectEqual(root(1), Sigma.summaries[Sigma.find(&root(3)).?].F.root);
    try testing.expectEqual(root(0), Sigma.F.root);
    try testing.expect(!Sigma.hasViableDescendant(&root(1)));
    try add(Sigma, 4, 4, 3, .{ .h = 5, .T_h = ref(4, 4), .h_j = 4, .J = ref(3, 3), .h_F = 1, .F = ref(1, 1) });
    try testing.expectEqual(root(1), Sigma.F.root);
    try testing.expect(Sigma.hasViableDescendant(&root(1)));
    try testing.expectEqual(@as(u32, 10), Sigma.T.count);
    var buffer: FG.FrameBuffer = undefined;
    const Phi = try Sigma.toAC(&buffer);
    try testing.expectEqual(root(1), Phi.tree[0].root);
    try testing.expectEqual(@as(usize, 4), Phi.tree.len);
}

test "FG owns accepted lists and later caller mutation cannot change stored content or frames" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    var raw = [_]Frame.SignedVote{.{
        .vote = .{ .val_index = 0, .slot = 0, .head = root(0) },
        .authenticated = true,
    }};
    var support = [_]@import("../types.zig").GoldfishVote{raw[0].vote};
    var a = [_]fg.Attestation{.{ .val_index = 0, .h = 1, .T = root(0), .tau = false }};
    var B: fg.Block = .{
        .root = root(1),
        .parent = root(0),
        .slot = 1,
        .proposer = 0,
        .ac_payload = .{ .votes = &raw, .support_votes = &support },
        .attestations = &a,
    };
    try testing.expect(try Sigma.onBlock(&B, &Sigma.summaries[0]));
    raw[0].vote.val_index = 3;
    support[0].val_index = 3;
    a[0].val_index = 3;
    B.root = root(99);
    B.parent = root(98);
    B.slot = 63;
    B.proposer = 3;
    B.ac_payload = .{};
    B.attestations = &.{};
    var buffer: FG.FrameBuffer = undefined;
    const Phi = try Sigma.toAC(&buffer);
    try testing.expectEqual(@as(u32, 0), Phi.tree[1].payload.votes[0].vote.val_index);
    try testing.expectEqual(@as(u32, 0), Phi.tree[1].payload.support_votes[0].val_index);
    try testing.expectEqual(@as(u32, 0), Sigma.T.buffer[1].attestations.buffer[0].val_index);
    try testing.expectEqual(root(1), Sigma.T.buffer[1].root);
    try testing.expectEqual(root(0), Sigma.T.buffer[1].parent);
    try testing.expectEqual(@as(u32, 1), Sigma.T.buffer[1].slot);
    try testing.expectEqual(@as(u32, 0), Sigma.T.buffer[1].proposer);
    try add(Sigma, 2, 2, 1, .{ .h = 2, .T_h = ref(2, 2), .h_j = 1, .J = ref(0, 0) });
    try add(Sigma, 3, 3, 2, .{ .h = 3, .T_h = ref(3, 3), .h_j = 2, .J = ref(2, 2) });
    try add(Sigma, 4, 4, 3, .{ .h = 4, .T_h = ref(4, 4), .h_j = 3, .J = ref(3, 3), .h_F = 2, .F = ref(2, 2) });
    const rebuilt = try Sigma.toAC(&buffer);
    try testing.expectEqual(root(2), rebuilt.tree[0].root);
    try testing.expectEqual(root(3), rebuilt.fc_root);
    try testing.expectEqual(@as(usize, 3), rebuilt.tree.len);
    try testing.expectEqual(@as(?u32, null), Sigma.find(&root(99)));
}

test "included attestations are found along the whole parent chain and nowhere else" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    const a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    var b = a;
    b.tau = true;
    const carried = [_]fg.Attestation{a};
    const B: fg.Block = .{ .root = root(1), .slot = 1, .parent = root(0), .proposer = 0, .attestations = &carried };
    try testing.expect(try Sigma.onBlock(&B, &Sigma.summaries[0]));
    try add(Sigma, 2, 2, 1, .{ .h = 1, .T_h = ref(0, 0) });
    try add(Sigma, 3, 1, 0, .{ .h = 1, .T_h = ref(0, 0) });
    try testing.expect(Sigma.includedOnChain(Sigma.find(&root(1)).?, &a));
    try testing.expect(Sigma.includedOnChain(Sigma.find(&root(2)).?, &a));
    try testing.expect(!Sigma.includedOnChain(Sigma.find(&root(2)).?, &b));
    try testing.expect(!Sigma.includedOnChain(Sigma.find(&root(3)).?, &a));
    try testing.expect(!Sigma.includedOnChain(0, &a));
}

test "refused blocks do not mutate caches or accepted summaries" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    try add(Sigma, 1, 1, 0, .{ .h = 2, .T_h = ref(1, 1), .h_j = 1, .J = ref(0, 0) });
    const before = try testing.allocator.create(FG);
    defer testing.allocator.destroy(before);
    before.* = Sigma.*;
    var B: fg.Block = .{ .root = root(1), .parent = root(0), .slot = 1, .proposer = 0 };
    try testing.expect(!Sigma.canAccept(&B));
    try testing.expect(!try Sigma.onBlock(&B, &Sigma.summaries[1]));
    B.root = root(2);
    B.parent = root(99);
    try testing.expect(!Sigma.canAccept(&B));
    try testing.expect(!try Sigma.onBlock(&B, &Sigma.summaries[1]));
    try expectSame(before, Sigma);
}

test "block and payload bounds are explicit failures without partial import" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    var B: fg.Block = .{ .root = root(1), .parent = root(0), .slot = 1, .proposer = 0 };
    const oversized = try testing.allocator.alloc(Frame.SignedVote, limits.max_vote_set + 1);
    defer testing.allocator.free(oversized);
    B.ac_payload.votes = oversized;
    try testing.expectError(error.PayloadCapacity, Sigma.onBlock(&B, &Sigma.summaries[0]));
    try testing.expectEqual(@as(u32, 1), Sigma.T.count);
    for (1..limits.max_blocks) |i| try add(Sigma, @intCast(i), 1, 0, .{ .h = 1, .T_h = ref(0, 0) });
    B.root = root(limits.max_blocks);
    B.ac_payload = .{};
    try testing.expectError(error.BlockCapacity, Sigma.onBlock(&B, &Sigma.summaries[0]));
    try testing.expectEqual(limits.max_blocks, Sigma.T.count);
}

test "attestation input reads confirmed height and head finality without mixing the two states" {
    const Sigma = try create();
    defer testing.allocator.destroy(Sigma);
    try add(Sigma, 1, 1, 0, .{ .h = 2, .T_h = ref(1, 1), .h_j = 1, .J = ref(0, 0) });
    try add(Sigma, 2, 2, 1, .{ .h = 3, .T_h = ref(2, 2), .h_j = 2, .J = ref(1, 1) });
    const input = try Sigma.attestationInput(&root(1), &root(2));
    try testing.expectEqual(@as(?u32, 2), input.h_c);
    try testing.expectEqual(@as(?fg.Root, root(1)), input.T_c);
    try testing.expectEqual(@as(u32, 2), input.h_j);
    try testing.expectEqual(root(1), input.J);
    try testing.expectEqual(@as(u32, 0), input.h_F);
    const Lambda = try testing.allocator.create(SigningRecord);
    defer testing.allocator.destroy(Lambda);
    try Lambda.init(.{ .n = 4, .val_index = 0 });
    const a = (try Lambda.createAttestation(&input)).?;
    try testing.expectEqual(@as(u32, 2), a.h);
    try testing.expectEqual(root(1), a.T);
    try testing.expectEqual(@as(?u32, null), a.h_f);
    try testing.expectEqual(@as(u32, 1), Lambda.sent.count);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&input));
    try testing.expectError(error.UnknownBlock, Sigma.attestationInput(&root(99), &root(2)));
}
