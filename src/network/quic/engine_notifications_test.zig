const std = @import("std");
const support = @import("test_support.zig");
const Engine = @import("Engine.zig");

test "engine notifications deliver a later close during sustained earlier stream churn" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    const victim = try pair.server.dial(&support.client_address, pair.client_ctx.local_peer_id, pair.now);
    try std.testing.expect(pair.server.failSend(victim));
    var one: [1]Engine.Event = undefined;
    var delivered = false;
    for (0..8) |turn| {
        const outgoing = try pair.client.openStream(handles.client);
        _ = try pair.client.write(outgoing, "x", true);
        try pair.pump();
        try std.testing.expectEqual(@as(usize, 0), pair.server.pollEvents(&.{}));
        for (0..2) |_| {
            const count = pair.server.pollEvents(&one);
            if (count == 0) continue;
            switch (one[0]) {
                .stream_opened => |stream| pair.server.closeStream(stream, 1),
                .stream_closed => |event| try std.testing.expectEqual(handles.server, event.stream.conn),
                .closed => {
                    _ = try support.expectClosed(one[0], victim, .outbound, null);
                    try std.testing.expect(!delivered);
                    delivered = true;
                },
                else => return error.UnexpectedEvent,
            }
            try pair.pump();
            pair.server.releaseReported();
        }
        if (turn >= 1) try std.testing.expect(delivered);
    }
    try std.testing.expectEqual(@as(u16, 1), pair.server.registry.active_len);
    try std.testing.expect(pair.server.peerId(victim) == null);
}

test "engine notifications deliver higher stream slot while lower slots recycle" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var outgoing = try pair.client.openStream(handles.client);
    _ = try pair.client.write(outgoing, "x", true);
    const victim = try pair.client.openStream(handles.client);
    _ = try pair.client.write(victim, "y", true);
    try pair.pump();
    var one: [1]Engine.Event = undefined;
    var delivered = false;
    var low_opens: usize = 0;
    var opened: [128]?u64 = [_]?u64{null} ** 128;
    for (0..32) |turn| {
        if (turn > 0) {
            outgoing = try pair.client.openStream(handles.client);
            _ = try pair.client.write(outgoing, "x", true);
            try pair.pump();
        }
        for (0..2) |_| {
            try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
            switch (one[0]) {
                .stream_opened => |stream| {
                    try std.testing.expectEqual(handles.server, stream.conn);
                    try std.testing.expect(opened[stream.slot] == null);
                    opened[stream.slot] = stream.id;
                    if (stream.id == victim.id) {
                        try std.testing.expect(!delivered);
                        try std.testing.expectEqual(@as(u8, 65), stream.slot);
                        delivered = true;
                    } else {
                        if (stream.slot == 64) low_opens += 1;
                        pair.server.closeStream(stream, 1);
                    }
                },
                .stream_closed => |event| {
                    try std.testing.expectEqual(@as(?u64, event.stream.id), opened[event.stream.slot]);
                    opened[event.stream.slot] = null;
                },
                else => return error.UnexpectedEvent,
            }
            try pair.pump();
        }
        if (turn >= 1) try std.testing.expect(delivered);
    }
    try std.testing.expect(low_opens > 1);
}

test "engine notifications preserve generations through active swaps retirement and wrap" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{ .connections_max = 4, .handshaking_max = 4, .dialing_max = 4, .outbound_max = 4 });
    defer pair.deinit();
    _ = try support.connectPair(&pair);
    var owners: [3]Engine.Handle = undefined;
    for (&owners) |*owner| {
        owner.* = try pair.server.dial(&support.client_address, pair.client_ctx.local_peer_id, pair.now);
        try std.testing.expect(pair.server.failSend(owner.*));
    }
    var one: [1]Engine.Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.server.pollEvents(&.{}));
    try std.testing.expect(pair.server.eventsPending());
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    _ = try support.expectClosed(one[0], owners[0], .outbound, null);
    pair.server.releaseReported();
    try std.testing.expectEqual(owners[2].index, pair.server.registry.active[1]);
    const replacement = try pair.server.dial(&support.client_address, pair.client_ctx.local_peer_id, pair.now);
    try std.testing.expectEqual(owners[0].index, replacement.index);
    try std.testing.expect(replacement.generation != owners[0].generation);
    try std.testing.expect(pair.server.failSend(replacement));
    const expected = [_]Engine.Handle{ owners[1], owners[2], replacement };
    for (expected) |owner| {
        try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
        _ = try support.expectClosed(one[0], owner, .outbound, null);
        pair.server.releaseReported();
    }
    try std.testing.expectEqual(@as(u16, 1), pair.server.registry.active_len);
    try std.testing.expectEqual(@as(usize, 0), pair.server.pollEvents(&one));
    try std.testing.expect(!pair.server.eventsPending());
}

test "engine notifications preserve lifecycle order across one-event polls" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const client = try pair.dial();
    try pair.pump();
    const server = pair.server.sendOwner(0).?;
    const rebound = Engine.Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4003 } };
    pair.client_source = rebound;
    const outgoing = try pair.client.openStream(client);
    _ = try pair.client.write(outgoing, &([_]u8{1} ** 2000), false);
    try pair.pump();
    try std.testing.expectEqual(rebound, pair.server.peerAddress(server).?);
    var one: [1]Engine.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    _ = try support.expectConnected(one[0], .inbound, &pair.client_ctx);
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    try std.testing.expectEqual(server, one[0].path_changed.conn);
    try std.testing.expectEqual(rebound, one[0].path_changed.peer);
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    const incoming = try support.expectStreamOpened(one[0], server);
    pair.server.closeStream(incoming, 1);
    try std.testing.expect(pair.server.failSend(server));
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    _ = try support.expectStreamClosed(one[0], incoming);
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    _ = try support.expectClosed(one[0], server, .inbound, &pair.client_ctx);
    pair.server.releaseReported();
    try std.testing.expectEqual(@as(u16, 0), pair.server.registry.active_len);
}
