const std = @import("std");
const identify = @import("root.zig");
const support = @import("../quic/test_support.zig");
const peerId = @import("test_support.zig").peerId;
const types = @import("../types.zig");
const multiaddr = @import("../wire/multiaddr.zig");

test "identify advertises each usable bound address despite another wildcard family" {
    const peer = try peerId();
    const address: types.Address = .{ .ip6 = .{ .octets = std.Io.net.Ip6Address.loopback(9000).bytes, .port = 9000 } };
    const bound = [2]?types.Address{ .{ .ip4 = .{ .octets = @splat(0), .port = 9000 } }, address };
    const local = try (identify.Handler.Options{}).makeLocal(&peer, &bound);
    try std.testing.expectEqual(@as(u8, 1), local.address_count);
    var encoded: [multiaddr.binary_length_max]u8 = undefined;
    const expected = try (multiaddr.Multiaddr{ .address = address }).encode(&encoded);
    const retained = local.addresses[0];
    try std.testing.expectEqualSlices(u8, expected, retained.bytes[0..retained.len]);
}

test "identify local construction copies explicit text and address intent" {
    const peer = try peerId();
    var agent = [_]u8{ 'o', 'l', 'd' };
    var addresses = [_]types.Address{
        .{ .ip4 = .{ .octets = .{ 127, 3, 2, 1 }, .port = 19001 } },
        .{ .ip6 = .{ .octets = std.Io.net.Ip6Address.loopback(19002).bytes, .port = 19002 } },
    };
    const opts: identify.Handler.Options = .{ .agent = &agent, .addresses = &addresses };
    const bound = [2]?types.Address{ support.client_address, null };
    const local = try opts.makeLocal(&peer, &bound);
    agent[0] = 'x';
    addresses[0].ip4.port = 19999;
    try std.testing.expectEqualStrings("old", local.agent.slice());
    try std.testing.expectEqual(@as(u8, 2), local.address_count);
    const retained = local.addresses[0];
    const decoded = try multiaddr.Multiaddr.decode(retained.bytes[0..retained.len]);
    try std.testing.expectEqual(@as(u16, 19001), decoded.address.port());
    var encoded: [identify.codec.encoded_frame_max]u8 = undefined;
    const frame = try local.encode(.initEmpty(), null, &encoded);
    var decoder = identify.codec.Decoder.init(&peer);
    try decoder.feed(frame, true);
    try std.testing.expectEqualStrings("old", decoder.result().?.agent.?.slice());
}

test "identify options validate the same capacities text and addresses as construction" {
    const peer = try peerId();
    const bound = [2]?types.Address{ support.client_address, null };
    var addresses: [9]types.Address = @splat(support.server_address);
    const valid: identify.Handler.Options = .{ .addresses = addresses[0..8] };
    try valid.validate();
    const accepted = try valid.makeLocal(&peer, &bound);
    try std.testing.expectEqual(@as(u8, 8), accepted.address_count);
    addresses[0].ip4.port = 0;
    const Case = struct { options: identify.Handler.Options, err: identify.Handler.Options.Error };
    for ([_]Case{
        .{ .options = .{ .inbound_max = 0 }, .err = error.InvalidLimits },
        .{ .options = .{ .inbound_max = 65 }, .err = error.InvalidLimits },
        .{ .options = .{ .outbound_max = 0 }, .err = error.InvalidLimits },
        .{ .options = .{ .outbound_max = 65 }, .err = error.InvalidLimits },
        .{ .options = .{ .addresses = &addresses }, .err = error.OccurrenceLimit },
        .{ .options = .{ .addresses = addresses[0..1] }, .err = error.InvalidAddress },
        .{ .options = .{ .agent = &.{0xff} }, .err = error.InvalidUtf8 },
        .{ .options = .{ .protocol_version = &.{0xff} }, .err = error.InvalidUtf8 },
        .{ .options = .{ .protocol_version = &(@as([65]u8, @splat('a'))) }, .err = error.StringLimit },
        .{ .options = .{ .agent = &(@as([257]u8, @splat('a'))) }, .err = error.StringLimit },
    }) |case| {
        try std.testing.expectError(case.err, case.options.validate());
        try std.testing.expectError(case.err, case.options.makeLocal(&peer, &bound));
    }
}
