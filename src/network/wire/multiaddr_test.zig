const std = @import("std");
const multiaddr = @import("multiaddr.zig");
const peer_id = @import("peer_id.zig");

const spec_peer_id = "16Uiu2HAkutTMoTzDw1tCvSRtu6YoixJwS46S1ZFxW8hSx9fWHiPs";
const ip4_text = "/ip4/127.0.0.1/udp/4001/quic-v1/p2p/" ++ spec_peer_id;
const ip6_text = "/ip6/::1/udp/9000/quic-v1";

test "multiaddr encodes ip4 with peer id" {
    const parsed = try multiaddr.Multiaddr.parse(ip4_text);
    try std.testing.expectEqual(@as(u16, 4001), parsed.address.port());
    try std.testing.expectEqualSlices(u8, &.{ 127, 0, 0, 1 }, &parsed.address.ip4.octets);
    const expected_id = try peer_id.PeerId.fromText(spec_peer_id);
    try std.testing.expect(parsed.peer.?.eql(&expected_id));

    var binary: [multiaddr.binary_length_max]u8 = undefined;
    const encoded = try parsed.encode(&binary);
    const prefix = [_]u8{ 0x04, 127, 0, 0, 1, 0x91, 0x02, 0x0f, 0xa1, 0xcd, 0x03, 0xa5, 0x03, 0x27 };
    try std.testing.expectEqualSlices(u8, &prefix, encoded[0..prefix.len]);
    try std.testing.expectEqualSlices(u8, &expected_id.bytes, encoded[prefix.len..]);

    const decoded = try multiaddr.Multiaddr.decode(encoded);
    try std.testing.expect(decoded.address.eql(parsed.address));
    try std.testing.expect(decoded.peer.?.eql(&expected_id));

    var text: [multiaddr.text_length_max]u8 = undefined;
    try std.testing.expectEqualStrings(ip4_text, try decoded.toText(&text));
}

test "multiaddr encodes ip6 without peer id" {
    const parsed = try multiaddr.Multiaddr.parse("/ip6/::1/udp/9000/quic-v1");
    try std.testing.expect(parsed.peer == null);
    var binary: [multiaddr.binary_length_max]u8 = undefined;
    const encoded = try parsed.encode(&binary);
    const expected = [_]u8{0x29} ++ [_]u8{0} ** 15 ++ [_]u8{ 1, 0x91, 0x02, 0x23, 0x28, 0xcd, 0x03 };
    try std.testing.expectEqualSlices(u8, &expected, encoded);
    const decoded = try multiaddr.Multiaddr.decode(encoded);
    var text: [multiaddr.text_length_max]u8 = undefined;
    try std.testing.expectEqualStrings(ip6_text, try decoded.toText(&text));
}

test "multiaddr rejects mapped IPv6 in both representations" {
    const mapped = [_]u8{0} ** 10 ++ [_]u8{ 0xff, 0xff, 127, 0, 0, 1 };
    const binary = [_]u8{0x29} ++ mapped ++ [_]u8{ 0x91, 0x02, 0x23, 0x28, 0xcd, 0x03 };
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.decode(&binary));
    for ([_][]const u8{ "/ip6/::ffff:127.0.0.1/udp/9000/quic-v1", "/ip6/0:0:0:0:0:ffff:7f00:1/udp/9000/quic-v1" }) |text| {
        try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse(text));
    }
    const address: multiaddr.Multiaddr = .{ .address = .{ .ip6 = .{ .octets = mapped, .port = 9000 } } };
    var encoded: [multiaddr.binary_length_max]u8 = undefined;
    var text: [multiaddr.text_length_max]u8 = undefined;
    try std.testing.expectError(error.InvalidMultiaddr, address.encode(&encoded));
    try std.testing.expectError(error.InvalidMultiaddr, address.toText(&text));
}

test "multiaddr rejects unsupported shapes" {
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip4/1.2.3.4/tcp/1/quic-v1"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip4/1.2.3.4/udp/1/quic"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip4/1.2.3.4/udp/1/quic-v1/extra"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip4/1.2.3.4/udp/70000/quic-v1"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("ip4/1.2.3.4/udp/1/quic-v1"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/dns4/example.com/udp/1/quic-v1"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.decode(&.{ 0x04, 1, 2, 3, 4, 0x91, 0x02, 0, 1, 0xcc, 0x03 }));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.decode(&.{ 0x04, 1, 2, 3, 4, 0x91, 0x02, 0, 1, 0xcd, 0x03, 0xa5, 0x03, 0x02, 0, 0 }));
    try std.testing.expectError(error.Truncated, multiaddr.Multiaddr.decode(&.{ 0x04, 1, 2 }));
    var small: [8]u8 = undefined;
    const parsed = try multiaddr.Multiaddr.parse("/ip4/1.2.3.4/udp/1/quic-v1");
    try std.testing.expectError(error.BufferTooSmall, parsed.encode(&small));
}

test "multiaddr rejects IPv6 interface scope without losing endpoint identity" {
    var endpoint = try multiaddr.Multiaddr.parse("/ip6/fe80::1/udp/9000/quic-v1");
    endpoint.address.ip6.interface = 7;
    var binary: [multiaddr.binary_length_max]u8 = undefined;
    var text: [multiaddr.text_length_max]u8 = undefined;
    try std.testing.expectError(error.InvalidMultiaddr, endpoint.encode(&binary));
    try std.testing.expectError(error.InvalidMultiaddr, endpoint.toText(&text));
    try std.testing.expectEqual(@as(u32, 7), endpoint.address.ip6.interface);
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip6/fe80::1%7/udp/9000/quic-v1"));
}

test "multiaddr round trips ip6 text that starts with the mapped prefix" {
    const inputs = [_][]const u8{
        &.{ 0x29, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x80, 0xda, 0xda, 0xa5, 0x04, 0x00, 0x00, 0x10, 0x00, 0x91, 0x02, 0x0f, 0xa1, 0xcd, 0x03 },
        &.{ 0x29, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xee, 0x91, 0x02, 0x0f, 0xa1, 0xcd, 0x03 },
        &.{ 0x29, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x24, 0x00, 0x00, 0x04, 0x2e, 0x2f, 0x2e, 0x00, 0x91, 0x02, 0x0f, 0xa1, 0xcd, 0x03 },
    };
    for (inputs) |bytes| {
        const first = try multiaddr.Multiaddr.decode(bytes);
        var text: [multiaddr.text_length_max]u8 = undefined;
        const rendered = try first.toText(&text);
        try std.testing.expect(std.mem.startsWith(u8, rendered, "/ip6/::ffff:"));
        const parsed = try multiaddr.Multiaddr.parse(rendered);
        try std.testing.expect(parsed.address.eql(first.address));
    }
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip6/::ffff:127.0.0.1/udp/4001/quic-v1"));
    try std.testing.expectError(error.InvalidMultiaddr, multiaddr.Multiaddr.parse("/ip6/::ffff:zz/udp/4001/quic-v1"));
}
