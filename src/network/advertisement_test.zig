const std = @import("std");
const ad = @import("advertisement.zig");
const Address = @import("discv5").types.Address;
const udp: [2]?Address = .{ .{ .ip4 = .{ .octets = @splat(0), .port = 9000 } }, null };
const quic: [2]?Address = .{ .{ .ip4 = .{ .octets = @splat(0), .port = 9001 } }, null };

test "wildcard startup omits endpoints, hints permit learning and explicit fields pin independently" {
    const empty = try ad.resolve(null, &.{}, &quic, &udp);
    try std.testing.expectEqualDeep(ad.Endpoints{}, empty.endpoints);
    try std.testing.expect(empty.observations[0].enabled);
    try std.testing.expect(!empty.observations[1].enabled);
    const hint: ad.Hints = .{ .ip4 = .{ 198, 51, 100, 1 }, .udp = 40000 };
    const cached = try ad.resolve(&hint, &.{}, &quic, &udp);
    try std.testing.expectEqual(@as(?u16, 40000), cached.endpoints.udp);
    try std.testing.expectEqual(@as(?u16, 9001), cached.endpoints.quic);
    try std.testing.expect(cached.observations[0].enabled);
    const pinned = try ad.resolve(&hint, &.{ .ip4 = .{ 192, 0, 2, 1 } }, &quic, &udp);
    try std.testing.expectEqual(@as(?u16, 9000), pinned.endpoints.udp);
    try std.testing.expect(!pinned.observations[0].enabled);
    const port_only = try ad.resolve(null, &.{ .udp = 443, .quic = 444 }, &quic, &udp);
    try std.testing.expectEqualDeep(ad.Endpoints{}, port_only.endpoints);
    try std.testing.expectEqual(@as(?u16, 443), port_only.observations[0].fixed_port);
    try std.testing.expectEqual(@as(?u16, 444), port_only.quic_ports[0]);
}

test "invalid hints and disabled families are dropped but invalid fixed configuration fails" {
    const hints: ad.Hints = .{ .ip4 = @splat(0), .ip6 = .{0} ** 15 ++ .{1}, .udp = 1, .udp6 = 2 };
    try std.testing.expectEqualDeep(ad.Endpoints{}, (try ad.resolve(&hints, &.{}, &quic, &udp)).endpoints);
    const concrete: [2]?Address = .{ .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } }, null };
    try std.testing.expectEqual(@as(?u16, 9000), (try ad.resolve(&hints, &.{}, &quic, &concrete)).endpoints.udp);
    try std.testing.expectError(error.InvalidAdvertisement, ad.resolve(null, &.{ .ip4 = @splat(0) }, &quic, &udp));
    try std.testing.expectError(error.InvalidAdvertisement, ad.resolve(null, &.{ .udp6 = 1 }, &quic, &udp));
    try std.testing.expectError(error.InvalidAdvertisement, ad.resolve(null, &.{ .quic = 0 }, &quic, &udp));
}

test "each address family resolves pins and listener ports independently" {
    const both_udp: [2]?Address = .{ udp[0], .{ .ip6 = .{ .octets = @splat(0), .port = 19000 } } };
    const both_quic: [2]?Address = .{ quic[0], .{ .ip6 = .{ .octets = @splat(0), .port = 19001 } } };
    const plan = try ad.resolve(&.{ .ip6 = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{1}, .udp6 = 41000 }, &.{ .ip4 = .{ 192, 0, 2, 1 }, .udp6 = 443 }, &both_quic, &both_udp);
    try std.testing.expect(!plan.observations[0].enabled);
    try std.testing.expect(plan.observations[1].enabled);
    try std.testing.expectEqual(@as(?u16, 9000), plan.endpoints.udp);
    try std.testing.expectEqual(@as(?u16, 443), plan.endpoints.udp6);
    try std.testing.expectEqual(@as(?u16, 19001), plan.endpoints.quic6);
}

test "advertisement never drops a listener IPv6 scope when copying its address" {
    const scoped: [2]?Address = .{ null, .{ .ip6 = .{ .octets = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{1}, .port = 9000, .interface = 7 } } };
    try std.testing.expectError(error.InvalidAdvertisement, ad.resolve(null, &.{}, &scoped, &scoped));
    const fixed: ad.Endpoints = .{ .ip6 = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{2} };
    const resolved = try ad.resolve(null, &fixed, &scoped, &scoped);
    try std.testing.expectEqual(fixed.ip6, resolved.endpoints.ip6);
    try std.testing.expectEqual(@as(?u16, 9000), resolved.endpoints.udp6);
}
