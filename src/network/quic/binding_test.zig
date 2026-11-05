const std = @import("std");
const binding = @import("binding.zig");
const Engine = @import("Engine.zig");
const limits = @import("limits.zig");
const support = @import("test_support.zig");

test "quiche config initializes with the transport bounds" {
    var config = try binding.Config.init(
        limits.idle_timeout_ms,
        limits.connection_window_max,
        limits.connection_window_max / 2,
        limits.initial_congestion_window_packets,
    );
    defer config.deinit();
    try std.testing.expect(binding.c.quiche_version_is_supported(1));
    try std.testing.expect(!binding.c.quiche_version_is_supported(0xdead_beef));
}

test "quiche error codes map to tagged errors" {
    try std.testing.expect((try binding.check(binding.c.QUICHE_ERR_DONE)) == null);
    try std.testing.expectError(error.StreamReset, binding.check(binding.c.QUICHE_ERR_STREAM_RESET));
    try std.testing.expectError(error.Unknown, binding.check(@as(isize, -999)));
    try std.testing.expectEqual(@as(usize, 7), try binding.check(@as(isize, 7)));
}

test "quiche peer transport parameters follow the C field layout" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_active_connection_id_limit(pair.server.config.ptr, 7);
    const handles = try support.connectPair(&pair);
    const conn = pair.client.registry.slots[handles.client.index].conn.?;
    var params = std.mem.zeroes(binding.c.quiche_transport_params);
    try std.testing.expect(binding.c.quiche_conn_peer_transport_params(conn, &params));
    try std.testing.expectEqual(@as(u64, 7), params.peer_active_conn_id_limit);
    try std.testing.expect(params.peer_disable_active_migration);
    try std.testing.expectEqual(@as(isize, binding.c.QUICHE_ERR_DONE), params.peer_max_datagram_frame_size);
}

test "quiche capacity query leaves the error code untouched on success and unknown streams" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_stream_data_bidi_remote(pair.server.config.ptr, 4096);
    const handles = try support.connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    const conn = pair.client.registry.slots[handles.client.index].conn.?;
    var code: u64 = 123;
    try std.testing.expectEqual(@as(isize, 4096), binding.c.quiche_conn_stream_capacity_with_error(conn, stream.id, &code));
    try std.testing.expectEqual(@as(u64, 123), code);

    try std.testing.expectEqual(@as(usize, 4096), try pair.client.write(stream, &@as([4096]u8, @splat(1)), false));
    try std.testing.expectEqual(@as(isize, 0), binding.c.quiche_conn_stream_capacity_with_error(conn, stream.id, &code));
    try std.testing.expectEqual(@as(u64, 123), code);
    try std.testing.expectEqual(@as(isize, binding.c.QUICHE_ERR_INVALID_STREAM_STATE), binding.c.quiche_conn_stream_capacity_with_error(conn, stream.id + 4, &code));
    try std.testing.expectEqual(@as(u64, 123), code);
}

test "quiche capacity query returns the STOP code before reclaiming the stream" {
    for ([_]u64{ 0, 7, std.math.maxInt(u62) }) |stop_code| {
        var pair: support.Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handles = try support.connectPair(&pair);
        const stream = try pair.client.openStream(handles.client);
        _ = try pair.client.write(stream, "x", true);
        try pair.pump();
        var events: [8]Engine.Event = undefined;
        const inbound = try support.expectStreamOpened(pair.events(&pair.server, &events)[0], handles.server);
        var buffer: [1]u8 = undefined;
        try std.testing.expect((try pair.server.read(inbound, &buffer)).fin);

        pair.client.shutdown(stream, .read, stop_code);
        try pair.flush(&pair.client);
        try pair.flush(&pair.server);
        try pair.flush(&pair.client);

        const conn = pair.server.registry.slots[handles.server.index].conn.?;
        var code: u64 = std.math.maxInt(u64);
        try std.testing.expectEqual(@as(isize, binding.c.QUICHE_ERR_STREAM_STOPPED), binding.c.quiche_conn_stream_capacity_with_error(conn, inbound.id, &code));
        try std.testing.expectEqual(stop_code, code);
        try std.testing.expectEqual(@as(isize, binding.c.QUICHE_ERR_INVALID_STREAM_STATE), binding.c.quiche_conn_stream_capacity_with_error(conn, inbound.id, &code));
        try std.testing.expectEqual(stop_code, code);
    }
}

test "socket addresses convert to posix storage" {
    const ip4 = binding.SockAddr.fromAddress(.{ .ip4 = .{ .octets = .{ 10, 0, 0, 1 }, .port = 4001 } });
    try std.testing.expectEqual(@as(std.posix.socklen_t, @sizeOf(std.posix.sockaddr.in)), ip4.len);
    try std.testing.expectEqual(std.posix.AF.INET, ip4.any().family);
    const ip6 = binding.SockAddr.fromAddress(.{ .ip6 = .{ .octets = [_]u8{0} ** 15 ++ [_]u8{1}, .port = 9000 } });
    try std.testing.expectEqual(@as(std.posix.socklen_t, @sizeOf(std.posix.sockaddr.in6)), ip6.len);
    try std.testing.expectEqual(std.posix.AF.INET6, ip6.any().family);
}

test "header info parses initial and short headers" {
    var token: [binding.Header.token_max]u8 = undefined;
    const initial = [_]u8{ 0xc3, 0x00, 0x00, 0x00, 0x01, 0x08 } ++ [_]u8{0xaa} ** 8 ++ [_]u8{0x04} ++ [_]u8{0xbb} ** 4 ++ [_]u8{0x00};
    const parsed = try binding.Header.parse(&initial, &token);
    try std.testing.expectEqual(binding.Header.Type.initial, parsed.packet_type);
    try std.testing.expectEqual(@as(u32, 1), parsed.version);
    try std.testing.expectEqualSlices(u8, &([_]u8{0xaa} ** 8), parsed.dcid.slice());
    try std.testing.expectEqualSlices(u8, &([_]u8{0xbb} ** 4), parsed.scid.slice());
    try std.testing.expectEqual(@as(usize, 0), parsed.token.len);

    const short = [_]u8{0x40} ++ [_]u8{0xcc} ** limits.local_cid_length ++ [_]u8{ 1, 2, 3, 4 };
    const short_parsed = try binding.Header.parse(&short, &token);
    try std.testing.expectEqual(binding.Header.Type.short, short_parsed.packet_type);
    try std.testing.expectEqualSlices(u8, &([_]u8{0xcc} ** limits.local_cid_length), short_parsed.dcid.slice());

    try std.testing.expectError(error.BufferTooShort, binding.Header.parse(&.{0xc3}, &token));
}

test "header info borrows only the token of the packet it parsed" {
    var token: [binding.Header.token_max]u8 = undefined;
    const prefix = [_]u8{ 0xc3, 0x00, 0x00, 0x00, 0x01, 0x08 } ++ [_]u8{0xaa} ** 8 ++ [_]u8{0x04} ++ [_]u8{0xbb} ** 4;
    const long = prefix ++ [_]u8{ 0x41, 0x2c } ++ [_]u8{0xa5} ** 300 ++ [_]u8{0x00};
    const long_parsed = try binding.Header.parse(&long, &token);
    try std.testing.expectEqualSlices(u8, &([_]u8{0xa5} ** 300), long_parsed.token);
    try std.testing.expectEqual(@as([*]const u8, &token), long_parsed.token.ptr);

    const short_token = prefix ++ [_]u8{ 0x03, 1, 2, 3, 0x00 };
    const short_parsed = try binding.Header.parse(&short_token, &token);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3 }, short_parsed.token);

    const empty = prefix ++ [_]u8{ 0x00, 0x00 };
    try std.testing.expectEqual(@as(usize, 0), (try binding.Header.parse(&empty, &token)).token.len);
    const short = [_]u8{0x40} ++ [_]u8{0xcc} ** limits.local_cid_length ++ [_]u8{ 1, 2, 3, 4 };
    try std.testing.expectEqual(@as(usize, 0), (try binding.Header.parse(&short, &token)).token.len);
}
