const std = @import("std");
const Processor = @import("GossipProcessor.zig");
const limits = @import("limits.zig");

test "block notification during dependency check retries and late report cannot settle an expired claim" {
    var table = try Processor.init(std.testing.allocator, @as(limits.Limits, @splat(.{ .items = 4, .bytes = 4096 })), 123);
    defer table.deinit();
    const data: [240]u8 = @splat(0);
    try std.testing.expect(try table.admit(.{
        .kind = .beacon_attestation,
        .fork = .electra,
        .digest = @splat(1),
        .peer = @splat(2),
        .context = &.{},
        .bytes = &data,
        .now = 1,
        .slot = 0,
        .deadline = 100,
    }));
    const check = table.claimChecks(2, 1);
    try std.testing.expectEqual(1, check.len);
    table.notifyBlock(@splat(0));
    try std.testing.expect(table.classify(check.tokens[0], .await_block));
    const retry = table.claimChecks(3, 1);
    try std.testing.expectEqual(1, retry.len);
    try std.testing.expect(table.classify(retry.tokens[0], .ready));
    table.maintain(60, 0);
    const batch = table.claim(60);
    try std.testing.expectEqual(1, batch.len);
    table.finish(&batch);
    table.expire(100);
    try std.testing.expect(!table.complete(batch.tokens[0], 101, false));
    try std.testing.expectEqual(1, table.drops[@intFromEnum(Processor.Kind.beacon_attestation)].get(.expired));
    try std.testing.expectEqual(0, table.occupied);
}

test "newest-first replacement preserves delivered work and rejects stale tokens after reuse" {
    const k = @intFromEnum(Processor.Kind.sync_committee);
    var table = try Processor.init(std.testing.allocator, @as(limits.Limits, @splat(.{ .items = 2, .bytes = 4096 })), 123);
    defer table.deinit();
    var input: Processor.Input = .{
        .kind = .sync_committee,
        .fork = .altair,
        .digest = @splat(0),
        .peer = @splat(1),
        .context = "receipt",
        .bytes = "first",
        .now = 1,
        .slot = 0,
        .deadline = 100,
    };
    try std.testing.expect(try table.admit(input));
    try std.testing.expect(!try table.admit(input));
    const batch = table.claim(1);
    table.finish(&batch);
    const first = batch.tokens[0];
    input.peer = @splat(2);
    input.bytes = "second";
    try std.testing.expect(try table.admit(input));
    input.peer = @splat(3);
    input.bytes = "third";
    try std.testing.expect(try table.admit(input));
    try std.testing.expectEqual(1, table.executing_items[k]);
    try std.testing.expectEqual(0, table.claim(2).len);
    try std.testing.expect(table.complete(first, 2, false));
    const next = table.claim(2);
    try std.testing.expectEqualStrings("third", table.get(next.tokens[0]).?.input);
    table.finish(&next);
    try std.testing.expect(table.complete(next.tokens[0], 3, false));
    try std.testing.expect(try table.admit(input));
    const reuse = table.claim(3);
    try std.testing.expectEqual(first.index, reuse.tokens[0].index);
    try std.testing.expect(reuse.tokens[0].generation > first.generation);
    table.finish(&reuse);
    try std.testing.expect(!table.complete(first, 4, false));
    try std.testing.expect(table.complete(reuse.tokens[0], 4, false));
    try std.testing.expectEqual(0, table.used_bytes[k]);
    try std.testing.expectEqual(0, table.executing_bytes[k]);
    try std.testing.expectEqual(0, table.sources.count());
}

test "allocation failure leaves an admitted replacement victim intact" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, exerciseAdmission, .{});
}

fn exerciseAdmission(allocator: std.mem.Allocator) !void {
    var table = try Processor.init(allocator, @as(limits.Limits, @splat(.{ .items = 2, .bytes = 4096 })), 123);
    defer table.deinit();
    var input: Processor.Input = .{
        .kind = .sync_committee,
        .fork = .altair,
        .digest = @splat(0),
        .peer = @splat(2),
        .context = "receipt",
        .bytes = "message",
        .now = 1,
        .slot = 0,
        .deadline = 100,
    };
    try std.testing.expect(try table.admit(input));
    input.peer = @splat(3);
    try std.testing.expect(try table.admit(input));
    input.peer = @splat(4);
    const accepted = table.admit(input) catch |err| {
        try std.testing.expectEqual(2, table.occupied);
        try std.testing.expectEqual(2, table.sources.count());
        return err;
    };
    try std.testing.expect(accepted);
    try std.testing.expectEqual(2, table.occupied);
}
