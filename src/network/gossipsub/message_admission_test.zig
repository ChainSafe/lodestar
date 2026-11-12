const std = @import("std");
const t = std.testing;
const Now = @import("../types.zig").Now;
const limits_mod = @import("../gossip_limits.zig");
const Gossipsub = @import("Gossipsub.zig");
const messages = @import("messages.zig");
const support = @import("test_support.zig");
const topic_policy = @import("topic_policy.zig");
const topic = @import("topic.zig");
const snappy = @import("snappy");

const name = "/eth2/01020304/beacon_block/ssz_snappy";
const kind = @intFromEnum(topic.Kind.beacon_block);

test "gossip admission enforces source and kind items independently of retained history" {
    const limits: limits_mod.Limits = @splat(.{ .items = 4, .bytes = 4096 });
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[kind] = .{ .count = 1, .ssz_max = 1024 };
    var g = try support.init(t.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary}, .payload_limits = limits, .validation_capacity = limits_mod.items(&limits), .validation_timeout_ms = 10 });
    defer g.deinit();
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try support.subscribe(&g, name);
    for (0..3) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;

    try t.expectEqual(@as(?usize, 1), try support.message(&g, 0, "one", 1));
    const accepted = inbox.last().handle;
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 0, "two", 2));
    const ignored = inbox.last().handle;
    try t.expectEqual(@as(?usize, 0), try support.message(&g, 0, "three", 3));
    try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.peer_validations)]);
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 1, "three", 3));
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 1, "four", 4));
    try t.expectEqual(@as(?usize, 0), try support.message(&g, 2, "five", 5));
    try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.kind_validations)]);
    try t.expectEqual(@as(usize, 4), g.resourceSnapshot().pending_validations);

    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(accepted, .accept, Now.fromMilliseconds(.{ .mono_ms = 6, .unix_s = 0 })));
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 2, "five", 7));
    try t.expectEqual(@as(usize, 1), g.messages.history.count);
    try t.expectEqual(@as(usize, 5), g.messages.store.used_entries);
    try t.expectEqual(@as(usize, 4), g.resourceSnapshot().pending_validations);
    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, g.report(ignored, .ignore, Now.fromMilliseconds(.{ .mono_ms = 8, .unix_s = 0 })));
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 0, "six", 9));

    g.messages.expire(&g.peers, 20);
    try t.expectEqual(@as(usize, 0), g.resourceSnapshot().pending_validations);
    try t.expectEqual(@as(usize, 1), g.messages.store.used_entries);
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 0, "seven", 21));
}

test "gossip admission enforces compressed pages independently of retained history" {
    const limits: limits_mod.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[kind] = .{ .count = 1, .ssz_max = 1024 };
    var g = try support.init(t.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary}, .payload_limits = limits, .validation_capacity = limits_mod.items(&limits) });
    defer g.deinit();
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try support.subscribe(&g, name);
    for (0..2) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;

    var random = std.Random.DefaultPrng.init(817);
    var payload: [513]u8 = undefined;
    random.random().bytes(&payload);
    var compressed: [1024]u8 = undefined;
    var len = try snappy.raw.compress(&payload, &compressed);
    try t.expect(len > 512);
    const now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    try t.expectEqual(@as(?usize, 1), support.receiveMessage(&g, 0, .{ .topic = name, .data = compressed[0..len] }, now));
    const accepted = inbox.last().handle;
    random.random().bytes(&payload);
    len = try snappy.raw.compress(&payload, &compressed);
    try t.expect(len > 512);
    const incoming = topic.validMessageId(name, &payload, .{});
    try t.expectEqual(@as(?usize, 0), support.receiveMessage(&g, 1, .{ .topic = name, .data = compressed[0..len] }, now));
    try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.kind_payload)]);
    try t.expectEqual(@as(usize, 1), g.messages.store.pending_by_kind[kind]);
    try t.expectEqual(@as(usize, 1), g.resourceSnapshot().pending_validations);
    try t.expect(!g.messages.known(incoming, 1));

    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(accepted, .accept, now));
    try t.expectEqual(@as(?usize, 1), support.receiveMessage(&g, 1, .{ .topic = name, .data = compressed[0..len] }, now));
    try t.expectEqual(@as(usize, 1), g.messages.store.pending_by_kind[kind]);
    try t.expectEqual(@as(usize, 1), g.messages.store.retained_by_kind[kind]);
    try t.expectEqual(@as(usize, 1), g.resourceSnapshot().pending_validations);
}
