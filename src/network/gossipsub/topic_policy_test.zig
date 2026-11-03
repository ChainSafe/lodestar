const std = @import("std");
const root = @import("root.zig");
const constants = @import("constants.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;

test "topic namespace implements immutable canonical lookup" {
    try canonical();
}

fn canonical() !void {
    const p = root.topic_policy;
    var boundaries = [_]p.Boundary{ full(.{ 1, 2, 3, 4 }), full(.{ 0xab, 0xcd, 0xef, 0x01 }) };
    var ns = try p.Namespace.init(std.testing.allocator, &boundaries);
    defer ns.deinit(std.testing.allocator);
    boundaries[0].rules[0].ssz_max = 0;
    const cases = .{
        .{ "beacon_block", 0 },                  .{ "beacon_aggregate_and_proof", 1 },
        .{ "beacon_attestation_0", 2 },          .{ "beacon_attestation_63", 65 },
        .{ "proposer_slashing", 66 },            .{ "attester_slashing", 67 },
        .{ "voluntary_exit", 68 },               .{ "sync_committee_contribution_and_proof", 69 },
        .{ "sync_committee_0", 70 },             .{ "sync_committee_3", 73 },
        .{ "light_client_finality_update", 74 }, .{ "light_client_optimistic_update", 75 },
        .{ "bls_to_execution_change", 76 },      .{ "blob_sidecar_0", 77 },
        .{ "blob_sidecar_127", 204 },            .{ "data_column_sidecar_0", 205 },
        .{ "data_column_sidecar_127", 332 },     .{ "execution_payload", 333 },
        .{ "payload_attestation_message", 334 }, .{ "execution_payload_bid", 335 },
        .{ "proposer_preferences", 336 },
    };
    inline for (cases) |case| {
        const first = ns.lookup("/eth2/01020304/" ++ case[0] ++ "/ssz_snappy").?;
        try std.testing.expectEqual(case[1], first.ordinal);
        try std.testing.expectEqual(@as(u32, 100), first.rule.ssz_max);
        try std.testing.expectEqual(case[1] + p.topics_per_boundary_max, ns.lookup("/eth2/abcdef01/" ++ case[0] ++ "/ssz_snappy").?.ordinal);
    }
    const bad = [_][]const u8{
        "/eth2/ABCDEF01/beacon_block/ssz_snappy",            "/eth2/abcdef02/beacon_block/ssz_snappy",
        "/eth2/01020304/beacon_attestation_64/ssz_snappy",   "/eth2/01020304/beacon_attestation_00/ssz_snappy",
        "/eth2/01020304/beacon_attestation_+1/ssz_snappy",   "/eth2/01020304/beacon_attestation_-1/ssz_snappy",
        "/eth2/01020304/beacon_attestation/ssz_snappy",      "/eth2/01020304/beacon_block_0/ssz_snappy",
        "/eth2/01020304/sync_committee_4/ssz_snappy",        "/eth2/01020304/blob_sidecar_128/ssz_snappy",
        "/eth2/01020304/data_column_sidecar_128/ssz_snappy", "/eth2/01020304/Beacon_block/ssz_snappy",
        "/eth2/01020304/beacon_block/ssz",                   "/eth2/01020304/beacon_block/ssz_snappy/",
        "",
    };
    for (bad) |name| try std.testing.expect(ns.lookup(name) == null);
}

const full = @import("topic_fixture.zig").full;

test "topic namespace validates descriptors before allocation" {
    const p = root.topic_policy;
    const a = std.testing.allocator;
    var boundary = full(.{ 1, 2, 3, 4 });
    try std.testing.expectError(error.InvalidTopicPolicy, p.Namespace.init(a, &.{}));
    try std.testing.expectError(error.InvalidTopicPolicy, p.Namespace.init(a, &.{ boundary, boundary }));
    var excessive: [65]p.Boundary = undefined;
    for (&excessive, 0..) |*b, i| b.* = full(.{ @intCast(i), 0, 0, 0 });
    try std.testing.expectError(error.InvalidTopicPolicy, p.Namespace.init(a, &excessive));
    var maximum = try p.Namespace.init(a, excessive[0..64]);
    defer maximum.deinit(a);
    try std.testing.expectEqual(@as(u16, 21568), maximum.topic_count);
    var name: [root.topic.topic_max_len]u8 = undefined;
    try std.testing.expectEqual(@as(u16, 21567), maximum.lookup(root.topic.buildCanonical(maximum.topicAt(21567), &name)).?.ordinal);
    inline for (.{ 0, 2, 7, 11, 12 }) |kind| {
        boundary = full(.{ 1, 2, 3, 4 });
        boundary.rules[kind].count += 1;
        try std.testing.expectError(error.InvalidTopicPolicy, p.Namespace.init(a, &.{boundary}));
    }
    for ([_]p.Rule{
        .{ .count = 0, .ssz_min = 0, .ssz_max = 1 },
        .{ .count = 1, .ssz_min = 11, .ssz_max = 10 },
        .{ .count = 1, .ssz_min = 0, .ssz_max = constants.MAX_PAYLOAD_SIZE + 1 },
    }) |rule| {
        boundary = full(.{ 1, 2, 3, 4 });
        boundary.rules[0] = rule;
        try std.testing.expectError(error.InvalidTopicPolicy, p.Namespace.init(a, &.{boundary}));
    }
    boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    try std.testing.expectError(error.InvalidTopicPolicy, p.Namespace.init(a, &.{boundary}));
    boundary.rules[0] = .{ .count = 1, .ssz_min = 0, .ssz_max = 0 };
    var ns = try p.Namespace.init(a, &.{boundary});
    defer ns.deinit(a);
    try std.testing.expect(ns.lookup("/eth2/01020304/beacon_block/ssz_snappy") != null);
    try std.testing.expect(ns.lookup("/eth2/01020304/beacon_attestation_0/ssz_snappy") == null);
}

const hoodi = @import("topic_fixture.zig").hoodi;

test "topic namespace storage matches its plan and frees every allocation prefix" {
    const boundaries = hoodi();
    var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
    var ns = try root.topic_policy.Namespace.init(ledger.allocator(), &boundaries);
    try std.testing.expectEqual(@as(u16, 804), ns.topic_count);
    try std.testing.expectEqual(root.topic_policy.Namespace.backingBytes(&boundaries), ledger.bytes);
    ns.deinit(ledger.allocator());
    try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationFailure, .{});
}

fn allocationFailure(a: std.mem.Allocator) !void {
    const boundaries = hoodi();
    var ns = try root.topic_policy.Namespace.init(a, &boundaries);
    defer ns.deinit(a);
}
