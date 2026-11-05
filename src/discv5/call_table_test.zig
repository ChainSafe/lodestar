const std = @import("std");
const CallTable = @import("CallTable.zig");
const message = @import("wire/message.zig");
const constants = @import("wire/constants.zig");
const types = @import("types.zig");
const test_support = @import("test_support.zig");

const fakeEndpoint = test_support.fakeEndpoint;

test "one active call per peer uses stale-safe handles" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 2);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const ping = pingRequest(1);
    const first = try begin(&table, peer, &ping, 10);
    try std.testing.expectError(error.PeerBusy, begin(&table, peer, &ping, 10));
    var moved_peer = peer;
    moved_peer.address.ip4.port = 9_101;
    try std.testing.expectError(
        error.PeerBusy,
        begin(&table, moved_peer, &ping, 10),
    );
    try std.testing.expect(table.cancel(first));
    const second = try begin(&table, peer, &ping, 10);
    try std.testing.expect(first.generation != second.generation);
    try std.testing.expect(table.requestBytes(first) == null);
    try std.testing.expect(!table.cancel(first));
}

test "call table owns encoded request bytes and tracks challenge nonce" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 2);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    var portal_protocol = [_]u8{ 'p', 'o', 'r', 't', 'a', 'l' };
    var payload = [_]u8{ 1, 2, 3 };
    const request = message.Message{ .talk_request = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .protocol = &portal_protocol,
        .request = &payload,
    } };
    const nonce = [_]u8{0x11} ** 12;
    const handle = try begin(&table, peer, &request, 10);
    @memset(&portal_protocol, 0);
    @memset(&payload, 0);
    var scratch: message.DecodeScratch = .{};
    const stored = try message.Message.decode(table.requestBytes(handle).?, &scratch);
    try std.testing.expectEqualSlices(u8, "portal", stored.talk_request.protocol);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3 }, stored.talk_request.request);
    try table.markSent(handle, &nonce, 10);
    try std.testing.expectEqual(
        handle,
        (try table.acceptChallenge(peer.address, &nonce, 9)).?,
    );
    try std.testing.expectError(
        error.HandshakeAttempted,
        table.acceptChallenge(peer.address, &nonce, 9),
    );
    const replacement_nonce = [_]u8{0x22} ** 12;
    try table.markSent(handle, &replacement_nonce, 20);
    try std.testing.expect((try table.acceptChallenge(peer.address, &nonce, 9)) == null);
    try std.testing.expectError(
        error.HandshakeAttempted,
        table.acceptChallenge(peer.address, &replacement_nonce, 19),
    );
}

test "call table rejects zero and excessive configured capacities" {
    var table: CallTable = undefined;
    try std.testing.expectError(
        error.InvalidCapacity,
        table.init(std.testing.allocator, 0),
    );
    try std.testing.expectError(
        error.InvalidCapacity,
        table.init(std.testing.allocator, CallTable.capacity_max + 1),
    );
}

test "only sent calls participate in nonce and response matching" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 2);
    defer table.deinit(std.testing.allocator);
    const ping = pingRequest(1);
    const peer_a = fakeEndpoint(1, 9_001);
    var peer_b = fakeEndpoint(2, 9_002);
    peer_b.address = peer_a.address;
    const handle_a = try begin(&table, peer_a, &ping, 100);
    const handle_b = try begin(&table, peer_b, &ping, 100);
    const nonce = [_]u8{0x11} ** 12;
    try table.markSent(handle_a, &nonce, 100);
    try std.testing.expectError(
        error.NonceInUse,
        table.markSent(handle_b, &nonce, 100),
    );
    const pong = message.Message{ .pong = .{
        .request_id = ping.ping.request_id,
        .enr_sequence = 1,
        .recipient_ip = .{ .ip4 = .{ 127, 0, 0, 1 } },
        .recipient_port = 9_001,
    } };
    try std.testing.expectError(
        error.UnknownCall,
        accept(&table, peer_b, &pong, 99, &.{}),
    );
}

test "response matching validates type ID and NODES packet count before mutation" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 2);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const nonce = [_]u8{0x11} ** 12;
    const request = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .distances = &.{256},
    } };
    const handle = try begin(&table, peer, &request, 100);
    try table.markSent(handle, &nonce, 100);
    const wrong_id = nodesResponse(2, 2);
    try std.testing.expectError(
        error.RequestIdMismatch,
        accept(&table, peer, &wrong_id, 99, &.{}),
    );
    const invalid_total = nodesResponse(1, 0);
    try std.testing.expectError(
        error.InvalidResponseCount,
        accept(&table, peer, &invalid_total, 99, &.{}),
    );

    const first = nodesResponse(1, 2);
    const first_result = try accept(&table, peer, &first, 98, &.{});
    try std.testing.expectEqual(handle, first_result.matched.handle);
    try std.testing.expect(!first_result.matched.terminal);
    const inconsistent = nodesResponse(1, 3);
    try std.testing.expectError(
        error.InvalidResponseCount,
        accept(&table, peer, &inconsistent, 99, &.{}),
    );
    const second = nodesResponse(1, 2);
    const second_result = try accept(&table, peer, &second, 99, &.{});
    try std.testing.expect(second_result.matched.terminal);
    try std.testing.expectEqual(@as(usize, 0), table.count());
}

test "expiry is bounded by caller output and removes exact generations" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 2);
    defer table.deinit(std.testing.allocator);
    const ping = pingRequest(1);
    const first = try begin(&table, fakeEndpoint(1, 9_001), &ping, 10);
    _ = try begin(&table, fakeEndpoint(2, 9_002), &ping, 10);
    var expired: [1]CallTable.Expired = undefined;
    try std.testing.expectEqual(@as(usize, 1), table.expire(10, &expired));
    try std.testing.expectEqual(first, expired[0].handle);
    try std.testing.expectEqual(@as(usize, 1), table.count());
    try std.testing.expectEqual(@as(?u64, 10), table.nextDeadlineMs());
    try std.testing.expectEqual(@as(usize, 1), table.expire(10, &expired));
    try std.testing.expectEqual(@as(usize, 0), table.count());
    try std.testing.expectEqual(@as(?u64, null), table.nextDeadlineMs());
}

test "expected endpoints and cached deadlines follow sent call lifetimes" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 2);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const ping = pingRequest(1);
    const handle = try begin(&table, peer, &ping, 100);
    try std.testing.expect(!table.expectsResponseFrom(&peer.address, 0));
    try table.markSent(handle, &([_]u8{1} ** 12), 150);
    try std.testing.expectEqual(@as(?u64, 150), table.nextDeadlineMs());
    try std.testing.expect(table.expectsResponseFrom(&peer.address, 149));
    var other_port = peer.address;
    other_port.ip4.port += 1;
    try std.testing.expect(!table.expectsResponseFrom(&other_port, 149));
    try std.testing.expect(!table.expectsResponseFrom(&peer.address, 150));

    const second = try begin(&table, fakeEndpoint(2, 9_002), &ping, 120);
    try std.testing.expectEqual(@as(?u64, 120), table.nextDeadlineMs());
    try std.testing.expect(table.cancel(second));
    try std.testing.expectEqual(@as(?u64, 150), table.nextDeadlineMs());
    try std.testing.expect(table.cancel(handle));
    try std.testing.expect(!table.expectsResponseFrom(&peer.address, 149));
    try std.testing.expect(table.nextDeadlineMs() == null);
}

test "FINDNODE accepts only requested unique records and caps the exchange" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(0, 9_001);
    const request = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .distances = &.{256},
    } };
    const handle = try begin(&table, peer, &request, 100);
    try table.markSent(handle, &([_]u8{0x11} ** 12), 100);

    var node_ids: [types.findnode_result_max]types.NodeId = undefined;
    for (&node_ids, 0..) |*node_id, index| {
        node_id.* = [_]u8{0} ** 32;
        node_id[0] = 0x80;
        node_id[31] = @intCast(index);
    }
    var raw: [types.findnode_result_max][]const u8 = undefined;
    @memset(&raw, &.{});
    const response = message.Message{ .nodes = .{
        .request_id = request.find_node.request_id,
        .total = 2,
        .enrs = &raw,
    } };
    const result = try accept(&table, peer, &response, 99, &node_ids);
    try std.testing.expect(result.matched.terminal);
    try std.testing.expectEqual(types.findnode_result_max, result.accepted_nodes.count());
    try std.testing.expectEqual(@as(usize, 0), table.count());
}

test "FINDNODE filters unsolicited and duplicate node IDs" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(0, 9_001);
    const request = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .distances = &.{256},
    } };
    const handle = try begin(&table, peer, &request, 100);
    try table.markSent(handle, &([_]u8{0x11} ** 12), 100);
    const valid = [_]u8{0x80} ++ ([_]u8{0} ** 31);
    const unsolicited = [_]u8{0x40} ++ ([_]u8{0} ** 31);
    const ids = [_]types.NodeId{ valid, unsolicited, valid };
    const raw = [_][]const u8{ &.{}, &.{}, &.{} };
    const response = message.Message{ .nodes = .{
        .request_id = request.find_node.request_id,
        .total = 1,
        .enrs = &raw,
    } };
    const result = try accept(&table, peer, &response, 99, &ids);
    try std.testing.expect(result.accepted_nodes.isSet(0));
    try std.testing.expectEqual(@as(usize, 1), result.accepted_nodes.count());
}

test "begin refuses a message that is not a request" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 1);
    defer table.deinit(std.testing.allocator);
    const pong = message.Message{ .pong = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .enr_sequence = 1,
        .recipient_ip = .{ .ip4 = .{ 127, 0, 0, 1 } },
        .recipient_port = 9_001,
    } };
    try std.testing.expectError(
        error.InvalidRequest,
        begin(&table, fakeEndpoint(1, 9_001), &pong, 10),
    );
}

test "accept refuses a handle whose call ended after matching" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const request = pingRequest(1);
    const handle = try begin(&table, peer, &request, 100);
    try table.markSent(handle, &([_]u8{0x11} ** 12), 100);
    const response = message.Message{ .pong = .{
        .request_id = request.ping.request_id,
        .enr_sequence = 1,
        .recipient_ip = .{ .ip4 = .{ 127, 0, 0, 1 } },
        .recipient_port = 9_001,
    } };
    const matched = try table.match(peer, &response, 99);
    try std.testing.expectEqual(handle, matched);
    try std.testing.expect(table.cancel(handle));
    try std.testing.expectError(
        error.StaleHandle,
        table.accept(matched, &response, &.{}, &([_]u8{0} ** 12)),
    );
}

test "responses at the deadline are not published" {
    var table: CallTable = undefined;
    try table.init(std.testing.allocator, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const request = pingRequest(1);
    const handle = try begin(&table, peer, &request, 100);
    try table.markSent(handle, &([_]u8{0x11} ** 12), 100);
    const response = message.Message{ .pong = .{
        .request_id = request.ping.request_id,
        .enr_sequence = 1,
        .recipient_ip = .{ .ip4 = .{ 127, 0, 0, 1 } },
        .recipient_port = 9_001,
    } };
    try std.testing.expectError(
        error.CallExpired,
        accept(&table, peer, &response, 100, &.{}),
    );
    try std.testing.expectEqual(@as(usize, 1), table.count());
}

fn begin(
    table: *CallTable,
    peer: types.Endpoint,
    request: *const message.Message,
    deadline_ms: u64,
) !CallTable.Handle {
    const remote_public_key = [_]u8{0x02} ** 33;
    return table.begin(
        peer,
        &remote_public_key,
        request,
        deadline_ms,
        constants.ordinary_plaintext_size_max,
    );
}

fn accept(
    table: *CallTable,
    peer: types.Endpoint,
    response: *const message.Message,
    now_ms: u64,
    node_ids: []const types.NodeId,
) !CallTable.MatchResult {
    const handle = try table.match(peer, response, now_ms);
    var nonce = [_]u8{0} ** 12;
    std.mem.writeInt(u64, nonce[0..8], now_ms, .big);
    return table.accept(handle, response, node_ids, &nonce);
}

fn pingRequest(id: u8) message.Message {
    return .{ .ping = .{
        .request_id = message.RequestId.init(&.{id}) catch unreachable,
        .enr_sequence = 1,
    } };
}

fn nodesResponse(id: u8, total: u64) message.Message {
    return .{ .nodes = .{
        .request_id = message.RequestId.init(&.{id}) catch unreachable,
        .total = total,
        .enrs = &.{},
    } };
}
