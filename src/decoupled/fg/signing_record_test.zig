const std = @import("std");
const testing = std.testing;
const SigningRecord = @import("SigningRecord.zig");
const fg = @import("finality_types.zig");
const limits = @import("../limits.zig");

fn root(n: u32) fg.Root {
    var result: fg.Root = @splat(0);
    std.mem.writeInt(u32, result[0..4], n, .little);
    return result;
}
fn input(h: u32, T: u32) SigningRecord.Input {
    return .{ .h_c = h, .T_c = root(T), .h_j = 0, .J = root(0), .h_F = 0 };
}
fn create() !*SigningRecord {
    const Lambda = try testing.allocator.create(SigningRecord);
    errdefer testing.allocator.destroy(Lambda);
    try Lambda.init(.{ .n = 4, .val_index = 0 });
    return Lambda;
}
fn expectSame(a: *const SigningRecord, b: *const SigningRecord) !void {
    try testing.expectEqual(a.val_index, b.val_index);
    try testing.expectEqualDeep(a.target, b.target);
    try testing.expectEqualDeep(a.timeout, b.timeout);
    try testing.expectEqualDeep(a.lock, b.lock);
    try testing.expectEqualDeep(a.sent.constSlice(), b.sent.constSlice());
}

test "a target is first at a height and conflicting entries produce distinct timeouts" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    const first = (try Lambda.createAttestation(&input(1, 1))).?;
    try testing.expect(!first.tau);
    try testing.expectEqual(root(1), Lambda.target[1].?);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&input(1, 1)));
    const second = (try Lambda.createAttestation(&input(1, 2))).?;
    try testing.expect(second.tau);
    try testing.expect(Lambda.timeout[1]);
    try testing.expectEqual(root(1), Lambda.target[1].?);
    const third = (try Lambda.createAttestation(&input(1, 3))).?;
    try testing.expect(third.tau);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&input(1, 2)));
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&input(1, 1)));
    try testing.expectEqual(@as(u32, 3), Lambda.sent.count);
}

test "finality pairs create durable locks and incompatible lower-height targets wait" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    var higher = input(2, 2);
    higher.h_j = 1;
    higher.J = root(1);
    const a = (try Lambda.createAttestation(&higher)).?;
    try testing.expectEqual(@as(?u32, 1), a.h_f);
    try testing.expectEqual(root(1), a.T_f.?);
    try testing.expectEqual(root(1), Lambda.lock[1].?);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&input(1, 9)));
    const compatible = (try Lambda.createAttestation(&input(1, 1))).?;
    try testing.expect(!compatible.tau);
    try testing.expectEqual(root(1), Lambda.target[1].?);
    const snapshot = Lambda.*;
    var restarted = Lambda.*;
    try testing.expectEqual(@as(?fg.Attestation, null), try restarted.createAttestation(&higher));
    try expectSame(&snapshot, &restarted);
}

test "a conflicting target or earlier timeout prevents attaching a finality pair" {
    for ([_]bool{ false, true }) |timeout| {
        const Lambda = try create();
        defer testing.allocator.destroy(Lambda);
        _ = try Lambda.createAttestation(&input(1, 9));
        if (timeout) _ = try Lambda.createAttestation(&input(1, 1));
        var higher = input(2, 2);
        higher.h_j = 1;
        higher.J = if (timeout) root(9) else root(1);
        const a = (try Lambda.createAttestation(&higher)).?;
        try testing.expectEqual(@as(?u32, null), a.h_f);
        try testing.expectEqual(@as(?fg.Root, null), a.T_f);
    }
}

test "an existing finality lock cannot switch to a different justification" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    var first = input(2, 2);
    first.h_j = 1;
    first.J = root(1);
    _ = try Lambda.createAttestation(&first);
    var other = input(3, 3);
    other.h_j = 1;
    other.J = root(9);
    const a = (try Lambda.createAttestation(&other)).?;
    try testing.expectEqual(@as(?u32, null), a.h_f);
    try testing.expectEqual(root(1), Lambda.lock[1].?);
}

test "the same attestation's finality pair constrains its height pair before stripping" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    var same_height = input(1, 2);
    same_height.h_j = 1;
    same_height.J = root(1);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&same_height));
    try testing.expectEqual(@as(u32, 0), Lambda.sent.count);
    same_height.T_c = root(1);
    const a = (try Lambda.createAttestation(&same_height)).?;
    try testing.expect(!a.tau);
    try testing.expectEqual(@as(?u32, null), a.h_f);
    try testing.expectEqual(@as(?fg.Root, null), Lambda.lock[1]);
    var below = input(2, 2);
    below.h_j = 3;
    below.J = root(3);
    const b = (try Lambda.createAttestation(&below)).?;
    try testing.expectEqual(@as(?u32, null), b.h_f);
    try testing.expectEqual(@as(?fg.Root, null), Lambda.lock[3]);
}

test "a changed finality pair does not permit sending the same height entry twice" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    var first = input(2, 2);
    _ = try Lambda.createAttestation(&first);
    first.h_j = 1;
    first.J = root(1);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&first));
    try testing.expectEqual(@as(?fg.Root, null), Lambda.lock[1]);
    try testing.expectEqual(@as(u32, 1), Lambda.sent.count);
}

test "bottom height, invalid inputs, and height bounds leave Lambda unchanged" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    const before = Lambda.*;
    var options: SigningRecord.Input = .{
        .h_c = null,
        .T_c = null,
        .h_j = 1,
        .J = root(1),
        .h_F = 0,
    };
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&options));
    try expectSame(&before, Lambda);
    options.T_c = root(0);
    try testing.expectError(error.InvalidInput, Lambda.createAttestation(&options));
    options.h_c = 0;
    try testing.expectError(error.InvalidInput, Lambda.createAttestation(&options));
    options.h_c = limits.max_heights;
    try testing.expectError(error.HeightCapacity, Lambda.createAttestation(&options));
    try expectSame(&before, Lambda);
}

test "sent capacity fails before writing a new finality lock or target" {
    const Lambda = try create();
    defer testing.allocator.destroy(Lambda);
    for (1..limits.max_sent_attestations + 1) |T| {
        _ = (try Lambda.createAttestation(&input(2, @intCast(T)))).?;
    }
    const before = Lambda.*;
    var next = input(3, 3);
    next.h_j = 1;
    next.J = root(1);
    try testing.expectError(error.SentCapacity, Lambda.createAttestation(&next));
    try expectSame(&before, Lambda);
    try testing.expectEqual(@as(?fg.Attestation, null), try Lambda.createAttestation(&input(2, 1)));
}
