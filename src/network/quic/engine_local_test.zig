const std = @import("std");
const constants = @import("../constants.zig");
const Engine = @import("Engine.zig");
const support = @import("test_support.zig");
const types = @import("../types.zig");

const Pair = support.Pair;
const client_address = support.client_address;
const server_address = support.server_address;
const other_client: types.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 4_001 } };
const other_server: types.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 3 }, .port = 4_002 } };

test "a dialed connection keeps the local address it was given and sends from it" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handle = try pair.client.dial(&server_address, &other_client, pair.server_ctx.local_peer_id, pair.now);
    var packet: [constants.datagram_size_max]u8 = undefined;
    const initial = pair.client.sendOne(handle.index, pair.now, &packet).?;
    try std.testing.expectEqualDeep(other_client, initial.from);
    try std.testing.expectEqualDeep(server_address, initial.to);
    try std.testing.expectEqualDeep(@as(?types.Address, other_client), pair.client.localAddress(handle));
    const ip6: types.Address = .{ .ip6 = .{ .octets = .{0} ** 15 ++ .{1}, .port = 4_001 } };
    try std.testing.expectError(error.AddressFamilyUnsupported, pair.client.dial(&server_address, &ip6, pair.server_ctx.local_peer_id, pair.now));
}

test "a datagram sent to another local address is dropped before quiche and answers no dial" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handle = try pair.dial();
    var packet: [constants.datagram_size_max]u8 = undefined;
    var retry: [constants.datagram_size_max]u8 = undefined;
    const initial = pair.client.sendOne(handle.index, pair.now, &packet).?;
    const answer = pair.server.receive(initial.bytes, &client_address, &server_address, pair.now, &retry);
    try std.testing.expect(answer == .retry);
    pair.client.sent(handle.index, pair.now, true);

    const slot = &pair.client.registry.slots[handle.index];
    var out: [constants.datagram_size_max]u8 = undefined;
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.client.receive(answer.retry, &server_address, &other_client, pair.now, &out));
    try std.testing.expect(!pair.client.dialAnswered(handle));
    try std.testing.expectEqual(@as(usize, 0), slot.receivedPackets());
    try std.testing.expect(!slot.pending_link.linked and !slot.dirty_link.linked);
    const ip6: types.Address = .{ .ip6 = .{ .octets = .{0} ** 15 ++ .{1}, .port = 4_001 } };
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.client.receive(answer.retry, &server_address, &ip6, pair.now, &out));

    try std.testing.expectEqual(handle, pair.client.receive(answer.retry, &server_address, &client_address, pair.now, &out).accepted);
    try std.testing.expect(pair.client.dialAnswered(handle));
}

test "an accepted connection takes the address its Initial was sent to and replies from it" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    pair.server_local = other_server;
    const handles = try support.connectPair(&pair);
    try std.testing.expectEqualDeep(@as(?types.Address, other_server), pair.server.localAddress(handles.server));
    try std.testing.expectEqualDeep(@as(?types.Address, client_address), pair.server.peerAddress(handles.server));
    try std.testing.expectEqualDeep(@as(?types.Address, client_address), pair.client.localAddress(handles.client));
    try std.testing.expectEqualDeep(@as(?types.Address, other_server), pair.client.peerAddress(handles.client));
    try std.testing.expect(pair.server.close(handles.server, 0));
    var packet: [constants.datagram_size_max]u8 = undefined;
    const closing = pair.server.sendOne(handles.server.index, pair.now, &packet).?;
    try std.testing.expectEqualDeep(other_server, closing.from);
    try std.testing.expectEqualDeep(client_address, closing.to);
}

test "an established connection ignores packets sent to another local address and does not migrate" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    try pair.pump();
    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 4), try pair.client.write(stream, "ping", false));
    var packet: [constants.datagram_size_max]u8 = undefined;
    const sent = pair.client.sendOne(handles.client.index, pair.now, &packet).?;
    try std.testing.expect(sent.bytes[0] & 0x80 == 0);
    pair.client.sent(handles.client.index, pair.now, false);

    const slot = &pair.server.registry.slots[handles.server.index];
    const received = slot.receivedPackets();
    var reply: [constants.datagram_size_max]u8 = undefined;
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(sent.bytes, &client_address, &other_server, pair.now, &reply));
    try std.testing.expectEqual(received, slot.receivedPackets());
    try std.testing.expect(!slot.pending_link.linked);
    try std.testing.expectEqualDeep(@as(?types.Address, server_address), pair.server.localAddress(handles.server));

    try std.testing.expectEqual(handles.server, pair.server.receive(sent.bytes, &client_address, &server_address, pair.now, &reply).accepted);
    try pair.pump();
    var events: [8]Engine.Event = undefined;
    var opened = false;
    for (pair.events(&pair.server, &events)) |event| {
        try std.testing.expect(event != .path_changed and event != .closed);
        opened = opened or event == .stream_opened;
    }
    try std.testing.expect(opened);
    for (pair.events(&pair.client, &events)) |event| try std.testing.expect(event != .path_changed and event != .closed);
    try std.testing.expectEqualDeep(@as(?types.Address, client_address), pair.server.peerAddress(handles.server));
}
