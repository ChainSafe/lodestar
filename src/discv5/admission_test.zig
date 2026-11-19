const Admission = @import("Admission.zig");
const std = @import("std");
const types = @import("types.zig");

test "discovery admission ignores ports and separates challenge and verification credit" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    var source = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    for (0..Admission.source_quota.burst) |i| {
        source.ip4.port = @intCast(i + 1);
        try std.testing.expect(admission.allow(.challenge, &source, 0));
        try std.testing.expect(admission.allow(.handshake, &source, 0));
    }
    try std.testing.expect(!admission.allow(.challenge, &source, 249));
    try std.testing.expect(!admission.allow(.handshake, &source, 249));
    try std.testing.expect(admission.allow(.challenge, &source, 250));
    try std.testing.expect(admission.allow(.handshake, &source, 250));
    try std.testing.expect(!admission.allow(.handshake, &source, 0));
    try std.testing.expect(admission.allow(.handshake, &source, 1_250));
}

test "discovery admission groups IPv6 prefixes and shares global credit across families" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    var source = types.Address{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8 } ++ .{0} ** 12, .port = 1 } };
    for (0..Admission.source_quota.burst) |i| {
        source.ip6.octets[15] = @intCast(i);
        try std.testing.expect(admission.allow(.handshake, &source, 0));
    }
    source.ip6.octets[15] += 1;
    try std.testing.expect(!admission.allow(.handshake, &source, 0));
    for (0..Admission.global_quota.burst - Admission.source_quota.burst) |i| {
        const other = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, @intCast(i) }, .port = 1 } };
        try std.testing.expect(admission.allow(.handshake, &other, 0));
    }
    source.ip6.octets[7] = 1;
    try std.testing.expect(!admission.allow(.handshake, &source, 49));
    try std.testing.expect(admission.allow(.handshake, &source, 50));
    try std.testing.expect(admission.allow(.challenge, &source, 50));
}

test "discovery admission refuses full source accounting until credit has replenished" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    for (0..Admission.source_capacity) |i| {
        const source = types.Address{ .ip4 = .{ .octets = .{ 192, 0, @intCast(i / 256), @intCast(i % 256) }, .port = 0 } };
        admission.sources.putAssumeCapacityNoClobber(source, .{});
        admission.sources.getPtr(source).?.buckets[@intFromEnum(Admission.Stage.handshake)].charged_until_ms = 250;
    }
    const other = types.Address{ .ip4 = .{ .octets = .{ 192, 1, 0, 1 }, .port = 0 } };
    try std.testing.expect(!admission.allow(.challenge, &other, 249));
    try std.testing.expect(!admission.sources.contains(other));
    try std.testing.expect(admission.allow(.challenge, &other, 250));
    try std.testing.expect(admission.sources.contains(other));
}

test "record verification charges records rather than packets without spending refused global credit" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    var address = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    for (0..Admission.record_global_quota.burst / Admission.record_source_quota.burst) |i| {
        address.ip4.octets[3] = @intCast(i + 1);
        for (0..2) |_| try std.testing.expect(admission.allowRecords(&address, types.findnode_result_max, 0));
        try std.testing.expect(!admission.allowRecords(&address, 1, 0));
    }
    address.ip4.octets[3] += 1;
    try std.testing.expect(!admission.allowRecords(&address, 1, 0));
    try std.testing.expect(admission.allowRecords(&address, 1, Admission.record_global_quota.interval_ms));
    try std.testing.expect(admission.allow(.handshake, &address, 0));
}

test "packet quotas admit full response bursts and bound repeated traffic from established sources" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    var address = types.Address{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8 } ++ .{0} ** 12, .port = 1 } };
    inline for (.{ Admission.Stage.packet, Admission.Stage.response }) |stage| {
        for (0..Admission.packet_source_quota.burst) |i| {
            address.ip6.port = @intCast(i + 1);
            address.ip6.octets[15] = @intCast(i);
            address.ip6.interface = @intCast(i);
            try std.testing.expect(admission.allow(stage, &address, 0));
        }
        try std.testing.expect(!admission.allow(stage, &address, 24));
        try std.testing.expect(admission.allow(stage, &address, 25));
    }
    try std.testing.expectEqual(@as(u32, 1), admission.sources.count());
}

test "unsolicited packet exhaustion leaves a bounded expected response allowance" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    for (0..Admission.packet_global_quota.burst) |i| {
        const source = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, @intCast(i) }, .port = 1 } };
        try std.testing.expect(admission.allow(.packet, &source, 0));
    }
    const expected = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 3, 1 }, .port = 1 } };
    try std.testing.expect(!admission.allow(.packet, &expected, 0));
    for (0..Admission.packet_source_quota.burst) |_| try std.testing.expect(admission.allow(.response, &expected, 0));
    try std.testing.expect(!admission.allow(.response, &expected, 0));
    try std.testing.expect(admission.allow(.packet, &expected, Admission.packet_global_quota.interval_ms));
}

test "source refusals preserve global credit and accounting stays fixed through source churn" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    const source = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    for (0..Admission.packet_source_quota.burst) |_| try std.testing.expect(admission.allow(.packet, &source, 0));
    const global_before = admission.global[@intFromEnum(Admission.Stage.packet)].charged_until_ms;
    for (0..100) |_| try std.testing.expect(!admission.allow(.packet, &source, 0));
    try std.testing.expectEqual(global_before, admission.global[@intFromEnum(Admission.Stage.packet)].charged_until_ms);

    const capacity = admission.sources.capacity();
    for (0..Admission.source_capacity * 2) |i| {
        const address = types.Address{ .ip4 = .{ .octets = .{ 198, 51, @intCast(i / 256), @intCast(i % 256) }, .port = 1 } };
        try std.testing.expect(admission.allow(.packet, &address, @intCast((i + 1) * 100)));
        try std.testing.expect(admission.sources.count() <= Admission.source_capacity);
    }
    try std.testing.expectEqual(capacity, admission.sources.capacity());
}

test "discovery admission fails closed when a charge would overflow monotonic time" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    const source = types.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    try std.testing.expect(!admission.allow(.handshake, &source, std.math.maxInt(u64)));
    try std.testing.expectEqual(@as(u64, 0), admission.global[1].charged_until_ms);
}

test "record admission sustains three full responses per hundred milliseconds" {
    var admission = try Admission.init(std.testing.allocator);
    defer admission.deinit(std.testing.allocator);
    for (0..100) |tick| {
        for (0..3) |peer| {
            const address: types.Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, @intCast(peer + 1) }, .port = 1 } };
            try std.testing.expect(admission.allowRecords(&address, types.findnode_result_max, tick * 100));
        }
    }
}
