const std = @import("std");
const Now = @import("../types.zig").Now;
const constants = @import("../constants.zig");
const Engine = @import("Engine.zig");
const limits = @import("limits.zig");
const support = @import("test_support.zig");
const types = @import("../types.zig");
const keys = @import("../wire/keys.zig");
const tls = @import("../tls/context.zig");

const Event = Engine.Event;
const Pair = support.Pair;
const client_address = support.client_address;
const server_address = support.server_address;
const connectPair = support.connectPair;
const expectClosed = support.expectClosed;

const client_ip6: types.Address = .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8 } ++ .{0} ** 11 ++ .{1}, .port = 4_001 } };
const server_ip6: types.Address = .{ .ip6 = .{ .octets = .{0} ** 15 ++ .{1}, .port = 4_002 } };
const admission_now: Engine.Now = Now.fromMilliseconds(.{ .mono_ms = 1_000, .unix_s = support.now_unix });

fn initAdmissionEngine(local: *const [2]?types.Address, seed: u8) !Engine {
    const key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{seed}));
    var context = try tls.Context.init(&key, support.now_unix, @splat(seed));
    errdefer context.deinit();

    return Engine.init(std.testing.allocator, .{
        .tls = context,
        .local = local.*,
        .seed = &@as([32]u8, @splat(seed)),
        .limits = .{ .connections_max = 4, .handshaking_max = 4, .handshaking_per_source_max = 1, .dialing_max = 4, .outbound_max = 4 },
    });
}

fn admitSource(server: *Engine, client: *Engine, source: *const types.Address) !Engine.Handle {
    const destination = server.local[if (source.* == .ip4) @as(usize, 0) else 1].?;
    const handle = try client.dial(&destination, server.tls.local_peer_id, admission_now);
    var packet: [constants.datagram_size_max]u8 = undefined;
    var response: [constants.datagram_size_max]u8 = undefined;
    const initial = client.sendOne(handle.index, admission_now, &packet) orelse return error.TestUnexpectedResult;
    const retry = server.receive(initial.bytes, source, admission_now, &response);
    try std.testing.expect(retry == .retry);
    const received = client.receive(retry.retry, &destination, admission_now, &packet);
    try std.testing.expect(received == .accepted);
    const validated = client.sendOne(handle.index, admission_now, &packet) orelse return error.TestUnexpectedResult;
    const admitted = server.receive(validated.bytes, source, admission_now, &response);
    try std.testing.expect(admitted == .accepted);
    return admitted.accepted;
}

fn expectSourceAdmission(first: *const types.Address, candidate: *const types.Address, same_group: bool) !void {
    var server = try initAdmissionEngine(&.{ server_address, server_ip6 }, 1);
    defer server.deinit();
    const first_local: [2]?types.Address = if (first.* == .ip4) .{ first.*, null } else .{ null, first.* };
    var first_client = try initAdmissionEngine(&first_local, 2);
    defer first_client.deinit();
    const candidate_local: [2]?types.Address = if (candidate.* == .ip4) .{ candidate.*, null } else .{ null, candidate.* };
    var candidate_client = try initAdmissionEngine(&candidate_local, 3);
    defer candidate_client.deinit();

    const pending = try admitSource(&server, &first_client, first);
    _ = try server.dial(candidate, candidate_client.tls.local_peer_id, admission_now);
    const before = server.resourceSnapshot();
    try std.testing.expectEqual(@as(usize, 2), before.active);
    try std.testing.expectEqual(@as(usize, 1), before.handshaking);

    const destination = server.local[if (candidate.* == .ip4) @as(usize, 0) else 1].?;
    const handle = try candidate_client.dial(&destination, server.tls.local_peer_id, admission_now);
    var packet: [constants.datagram_size_max]u8 = undefined;
    var response: [constants.datagram_size_max]u8 = undefined;
    const initial = candidate_client.sendOne(handle.index, admission_now, &packet) orelse return error.TestUnexpectedResult;
    const random_before = server.csprng;
    const outcome = server.receive(initial.bytes, candidate, admission_now, &response);
    try std.testing.expectEqualDeep(before, server.resourceSnapshot());
    if (same_group) {
        try std.testing.expect(outcome == .dropped);
        try std.testing.expectEqualDeep(random_before, server.csprng);
        try std.testing.expect(server.abandon(pending));
    } else {
        try std.testing.expect(outcome == .retry);
    }

    const admitted = try admitSource(&server, &candidate_client, candidate);
    try std.testing.expectEqual(candidate.*, server.peerAddress(admitted).?);
    try std.testing.expectEqual(@as(usize, if (same_group) 1 else 2), server.resourceSnapshot().handshaking);
}

test "engine source admission groups IPv4 hosts without ports" {
    try expectSourceAdmission(&client_address, &client_address, true);
    var candidate = client_address;
    candidate.ip4.port += 1;
    try expectSourceAdmission(&client_address, &candidate, true);
    candidate = client_address;
    candidate.ip4.octets[3] += 1;
    try expectSourceAdmission(&client_address, &candidate, false);
}

test "engine source admission groups IPv6 prefixes without ports or interfaces" {
    try expectSourceAdmission(&client_ip6, &client_ip6, true);
    for ([_]usize{ 8, 15 }) |octet| {
        var candidate = client_ip6;
        candidate.ip6.octets[octet] ^= 1;
        try expectSourceAdmission(&client_ip6, &candidate, true);
    }
    for ([_]usize{ 0, 7 }) |octet| {
        var candidate = client_ip6;
        candidate.ip6.octets[octet] ^= 1;
        try expectSourceAdmission(&client_ip6, &candidate, false);
    }
    var candidate = client_ip6;
    candidate.ip6.port += 1;
    try expectSourceAdmission(&client_ip6, &candidate, true);
    candidate = client_ip6;
    candidate.ip6.interface = 3;
    try expectSourceAdmission(&client_ip6, &candidate, true);
}

test "engine source admission separates address families" {
    try expectSourceAdmission(&client_address, &client_ip6, false);
    try expectSourceAdmission(&client_ip6, &client_address, false);
}

fn dialInitial(pair: *Pair, out: []u8) ![]u8 {
    const handle = try pair.dial();
    return pair.sendOne(&pair.client, handle.index, out) orelse error.TestUnexpectedResult;
}

fn dialValidatedInitial(pair: *Pair, out: []u8) ![]u8 {
    const handle = try pair.dial();
    const initial = pair.sendOne(&pair.client, handle.index, out) orelse return error.TestUnexpectedResult;
    var response: [constants.datagram_size_max]u8 = undefined;
    const outcome = pair.server.receive(initial, &client_address, pair.now, &response);
    try std.testing.expect(outcome == .retry);
    var reply: [constants.datagram_size_max]u8 = undefined;
    _ = pair.client.receive(outcome.retry, &server_address, pair.now, &reply);
    return pair.sendOne(&pair.client, handle.index, out) orelse error.TestUnexpectedResult;
}

test "engine incoming handshakes and closing slots preserve selected outgoing capacity" {
    var pair: Pair = .{};
    try pair.init(.{ .dialing_max = 4, .outbound_max = 8 }, .{ .connections_max = 4, .handshaking_max = 4, .handshaking_per_source_max = 4, .dialing_max = 1, .outbound_reserved = 1, .outbound_max = 4 });
    defer pair.deinit();
    var packet: [constants.datagram_size_max]u8 = undefined;
    var response: [constants.datagram_size_max]u8 = undefined;
    var incoming: [3]Engine.Handle = undefined;
    for (&incoming) |*handle| {
        const received = pair.server.receive(try dialValidatedInitial(&pair, &packet), &client_address, pair.now, &response);
        try std.testing.expect(received == .accepted);
        handle.* = received.accepted;
    }
    try std.testing.expectEqual(@as(u16, 3), pair.server.registry.active_len);
    const initial = try dialValidatedInitial(&pair, &packet);
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(initial, &client_address, pair.now, &response));
    const selected = try pair.server.dial(&client_address, pair.client_ctx.local_peer_id, pair.now);
    try std.testing.expectEqual(@as(u16, 4), pair.server.registry.active_len);
    try std.testing.expect(pair.server.close(incoming[0], 0));
    try std.testing.expectEqual(@as(u16, 4), pair.server.registry.active_len);
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(initial, &client_address, pair.now, &response));
    try std.testing.expect(pair.server.abandon(selected));
    try std.testing.expectEqual(@as(u16, 3), pair.server.registry.active_len);
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(initial, &client_address, pair.now, &response));
    _ = try pair.server.dial(&client_address, pair.client_ctx.local_peer_id, pair.now);
}

test "engine routes existing streams and replayed Initials while source admission is full" {
    var pair: Pair = .{};
    try pair.init(.{}, .{ .handshaking_per_source_max = 1 });
    defer pair.deinit();
    const handles = try connectPair(&pair);

    var packet: [constants.datagram_size_max]u8 = undefined;
    var response: [constants.datagram_size_max]u8 = undefined;
    const pending = pair.server.receive(
        try dialValidatedInitial(&pair, &packet),
        &client_address,
        pair.now,
        &response,
    );
    try std.testing.expect(pending == .accepted);
    try std.testing.expectEqual(@as(u16, 1), pair.server.registry.handshaking);
    try std.testing.expectEqual(@as(usize, 2), pair.server.registry.activeIndices().len);

    const random_before_refusal = pair.server.csprng;
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(
        try dialInitial(&pair, &packet),
        &client_address,
        pair.now,
        &response,
    ));
    try std.testing.expectEqualDeep(random_before_refusal, pair.server.csprng);
    try std.testing.expectEqual(@as(u16, 1), pair.server.registry.handshaking);
    try std.testing.expectEqual(@as(usize, 2), pair.server.registry.activeIndices().len);

    var replay: [constants.datagram_size_max]u8 = undefined;
    @memcpy(replay[0..pair.first_initial_len], pair.first_initial[0..pair.first_initial_len]);
    const routed = pair.server.receive(
        replay[0..pair.first_initial_len],
        &client_address,
        pair.now,
        &response,
    );
    try std.testing.expect(routed == .accepted);
    try std.testing.expectEqual(handles.server, routed.accepted);
    try std.testing.expectEqualDeep(random_before_refusal, pair.server.csprng);

    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 5), try pair.client.write(stream, "hello", false));
    try std.testing.expect(try pair.transfer(&pair.client, &pair.server, client_address, false));
    pair.settle(&pair.server);
    var storage: [8]Event = undefined;
    const inbound = try support.expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var buffer: [8]u8 = undefined;
    const received = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqualStrings("hello", buffer[0..received.len]);
    try std.testing.expectEqual(@as(u16, 1), pair.server.registry.handshaking);
    try std.testing.expectEqual(@as(usize, 2), pair.server.registry.activeIndices().len);
}

test "engine bounds concurrent dials and outbound connections" {
    var pair: Pair = .{};
    try pair.init(.{ .dialing_max = 2, .outbound_max = 3 }, .{ .handshaking_per_source_max = 8 });
    defer pair.deinit();

    _ = try pair.dial();
    _ = try pair.dial();
    try std.testing.expectError(error.DialLimit, pair.dial());
    try std.testing.expectEqual(@as(u16, 2), pair.client.registry.dialing);
    try std.testing.expectEqual(@as(u16, 2), pair.client.registry.outbound);

    try pair.pump();
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.dialing);
    try std.testing.expectEqual(@as(u16, 2), pair.client.registry.outbound);
    const third = try pair.dial();
    try std.testing.expectError(error.DialLimit, pair.dial());
    try pair.pump();
    try std.testing.expectEqual(@as(u16, 3), pair.client.registry.outbound);

    _ = pair.client.close(third, 0);
    try pair.pump();
    var storage: [16]Engine.Event = undefined;
    _ = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(u16, 2), pair.client.registry.outbound);
    _ = try pair.dial();
    try std.testing.expectEqual(@as(u16, 3), pair.client.registry.outbound);
    try std.testing.expectEqual(@as(u16, 1), pair.client.registry.dialing);
}

test "engine drops new handshakes when the server table is full" {
    var pair: Pair = .{};
    try pair.init(.{ .connections_max = 4, .handshaking_max = 4, .handshake_timeout_ms = 100 }, .{ .connections_max = 1, .handshaking_max = 1 });
    defer pair.deinit();
    _ = try connectPair(&pair);

    const second = try pair.dial();
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 1), pair.server.registry.activeIndices().len);
    pair.advance(100);
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.handshake_timeout,
        try expectClosed(client_events[0], second, .outbound, null),
    );
    try std.testing.expectError(error.TableFull, pair.server.dial(
        &client_address,
        pair.client_ctx.local_peer_id,
        pair.now,
    ));
}

test "engine caps inbound handshakes per source address" {
    var pair: Pair = .{};
    try pair.init(
        .{ .connections_max = 8, .handshaking_max = 8 },
        .{ .connections_max = 8, .handshaking_max = 8 },
    );
    defer pair.deinit();

    var response: [constants.datagram_size_max]u8 = undefined;
    var packet: [constants.datagram_size_max]u8 = undefined;
    var admitted: u16 = 0;
    var attempt: u16 = 0;
    while (attempt < limits.handshaking_per_source_max + 1) : (attempt += 1) {
        const initial = if (attempt < limits.handshaking_per_source_max)
            try dialValidatedInitial(&pair, &packet)
        else
            try dialInitial(&pair, &packet);
        try std.testing.expect(initial.len >= limits.client_initial_min);
        const outcome = pair.server.receive(
            initial,
            &client_address,
            pair.now,
            &response,
        );
        switch (outcome) {
            .accepted => admitted += 1,
            else => {},
        }
    }

    try std.testing.expectEqual(limits.handshaking_per_source_max, admitted);
    try std.testing.expectEqual(limits.handshaking_per_source_max, pair.server.registry.handshaking);

    const elsewhere = types.Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 4_001 } };
    const other = try dialInitial(&pair, &packet);
    const foreign = pair.server.receive(
        other,
        &elsewhere,
        pair.now,
        &response,
    );
    switch (foreign) {
        .retry => {},
        else => return error.TestUnexpectedResult,
    }
    try std.testing.expectEqual(limits.handshaking_per_source_max, pair.server.registry.handshaking);
}

test "engine startup seeds reproducible independent connection IDs and Retry keys" {
    var pair: Pair = .{};
    const bounded: Engine.Limits = .{ .connections_max = 4, .handshaking_max = 4, .outbound_max = 4 };
    try pair.init(bounded, bounded);
    defer pair.deinit();
    var repeated: Pair = .{};
    try repeated.init(bounded, bounded);
    defer repeated.deinit();

    try std.testing.expectEqualSlices(u8, &pair.client.retry_key, &repeated.client.retry_key);
    try std.testing.expectEqual(pair.client.registry.routes.seed, repeated.client.registry.routes.seed);
    try std.testing.expect(!std.mem.eql(u8, &pair.client.retry_key, &pair.server.retry_key));
    try std.testing.expect(pair.client.registry.routes.seed != pair.server.registry.routes.seed);
    try std.testing.expect(pair.client.registry.routes.seed != std.mem.readInt(u64, pair.client.retry_key[0..8], .little));

    const server_before = pair.server.csprng;
    for (0..4) |_| {
        const first = try pair.dial();
        const second = try repeated.dial();
        try std.testing.expect(pair.client.registry.slots[first.index].scid.eql(&repeated.client.registry.slots[second.index].scid));
    }
    try std.testing.expectEqualDeep(server_before, pair.server.csprng);
    const server = try pair.server.dial(&client_address, pair.client_ctx.local_peer_id, pair.now);
    try std.testing.expect(!pair.client.registry.slots[0].scid.eql(&pair.server.registry.slots[server.index].scid));
}

test "engine drops version negotiation packets instead of reflecting them" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();

    var packet = [_]u8{0} ** limits.client_initial_min;
    packet[0] = 0xc0;
    packet[5] = 0x08;
    @memset(packet[6..14], 0xaa);
    packet[14] = 0x05;
    @memset(packet[15..20], 0xbb);

    var response: [constants.datagram_size_max]u8 = undefined;
    try std.testing.expectEqual(
        Engine.ReceiveOutcome.dropped,
        pair.server.receive(
            &packet,
            &client_address,
            pair.now,
            &response,
        ),
    );
}

test "engine answers unsupported versions and drops unroutable packets" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();

    var initial = [_]u8{0} ** limits.client_initial_min;
    initial[0] = 0xc3;
    initial[1] = 0xba;
    initial[2] = 0xba;
    initial[3] = 0xba;
    initial[4] = 0xba;
    initial[5] = 0x08;
    @memset(initial[6..14], 0xaa);
    initial[14] = 0x04;
    @memset(initial[15..19], 0xbb);
    initial[19] = 0x00;
    var response: [constants.datagram_size_max]u8 = undefined;
    const outcome = pair.server.receive(
        &initial,
        &client_address,
        pair.now,
        &response,
    );
    switch (outcome) {
        .version_negotiation => |bytes| try std.testing.expect(bytes.len > 0),
        else => return error.TestUnexpectedResult,
    }

    var short = [_]u8{0x40} ++ [_]u8{0xcc} ** limits.local_cid_length ++ [_]u8{0} ** 20;
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(
        &short,
        &client_address,
        pair.now,
        &response,
    ));

    var tiny = [_]u8{ 0xc3, 0, 0, 0, 1, 0x08 } ++ [_]u8{0xaa} ** 8 ++ [_]u8{0x04} ++ [_]u8{0xbb} ** 4 ++ [_]u8{0x00};
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, pair.server.receive(
        &tiny,
        &client_address,
        pair.now,
        &response,
    ));
    try std.testing.expectEqual(@as(u16, 0), pair.server.registry.handshaking);
}

test "engine wakeup includes host handshake deadline before native timeout" {
    var pair: Pair = .{};
    try pair.init(.{ .handshake_timeout_ms = 1 }, .{});
    defer pair.deinit();
    _ = try pair.dial();
    const deadline = pair.client.nextDeadlineNs();
    try std.testing.expect(deadline != null);
    try std.testing.expect(deadline.? <= pair.now.nanos() + std.time.ns_per_ms);
}

test "engine rejects zero requested receive window budget" {
    var pair: Pair = .{};
    if (pair.init(.{ .receive_budget_bytes = 0 }, .{})) |_| {
        pair.deinit();
        return error.TestUnexpectedResult;
    } else |err| try std.testing.expectEqual(error.InvalidLimits, err);
}

test "engine retains a live routed stream across unrelated slot churn" {
    var pair: Pair = .{};
    try pair.init(.{ .connections_max = 4, .handshaking_max = 4 }, .{});
    defer pair.deinit();
    const before_first_dial = pair.client.csprng;
    const handles = try connectPair(&pair);
    pair.client.csprng = before_first_dial;
    try std.testing.expectError(error.TableFull, pair.client.dial(
        &support.server_address,
        pair.server_ctx.local_peer_id,
        pair.now,
    ));
    try std.testing.expectEqual(@as(u16, 1), pair.client.registry.active_len);
    try std.testing.expectEqual(@as(u16, 1), pair.client.registry.outbound);
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.dialing);
    try std.testing.expectEqual(@as(usize, 1), pair.client.registry.routes.count);
    for (0..256) |_| {
        const transient = try pair.dial();
        try std.testing.expect(pair.client.abandon(transient));
    }
    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 4), try pair.client.write(stream, "live", false));
    try pair.pump();
    var events: [8]Event = undefined;
    const inbound = try support.expectStreamOpened(pair.events(&pair.server, &events)[0], handles.server);
    var bytes: [4]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 4), (try pair.server.read(inbound, &bytes)).len);
    try std.testing.expectEqualStrings("live", &bytes);
    try std.testing.expect(pair.client.peerId(handles.client).?.eql(&pair.server_ctx.local_peer_id));
}

test "engine retirement preserves a CID reused by another connection" {
    var pair: Pair = .{};
    try pair.init(.{ .connections_max = 2, .handshaking_max = 2 }, .{});
    defer pair.deinit();
    const initial_random = pair.client.csprng;
    const first = try pair.dial();
    const cid = pair.client.registry.slots[first.index].scid;
    try std.testing.expect(pair.client.failSend(first));

    pair.client.csprng = initial_random;
    const replacement = try pair.dial();
    try std.testing.expect(first.index != replacement.index);
    try std.testing.expect(cid.eql(&pair.client.registry.slots[replacement.index].scid));
    try std.testing.expectEqual(@as(?u16, replacement.index), pair.client.registry.findRoute(&cid));
    var events: [2]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.client.pollEvents(&events));
    try std.testing.expectEqual(Engine.CloseReason.send_failed, try expectClosed(events[0], first, .outbound, null));
    pair.client.releaseReported();
    try std.testing.expectEqual(@as(?u16, replacement.index), pair.client.registry.findRoute(&cid));
    try std.testing.expectEqual(@as(usize, 1), pair.client.registry.routes.count);

    try pair.pump();
    const connected = pair.events(&pair.client, &events);
    try std.testing.expectEqual(@as(usize, 1), connected.len);
    try std.testing.expectEqual(replacement, try support.expectConnected(connected[0], .outbound, &pair.server_ctx));
}

test "engine resolved memory plan reports budgeted receive windows" {
    var pair: Pair = .{};
    try pair.init(.{ .connections_max = 1024, .receive_budget_bytes = 1024 * limits.connection_window_min }, .{});
    defer pair.deinit();
    const plan = pair.client.memoryPlan();
    try std.testing.expectEqual(@as(u64, 1024 * 1024 * 1024), plan.receive_window_bytes);
    try std.testing.expect(plan.receive_window_bytes <= plan.requested_receive_window_bytes);
}

test "engine rejects native timeout overflow" {
    const invalid = [_]Engine.Limits{
        .{ .idle_timeout_ms = std.math.maxInt(u64) },
    };
    for (invalid) |options| {
        var pair: Pair = .{};
        if (pair.init(options, .{})) |_| {
            pair.deinit();
            return error.TestUnexpectedResult;
        } else |err| try std.testing.expectEqual(error.InvalidLimits, err);
    }
}

test "engine wakeup includes keepalive and uses the supplied current time" {
    var pair: Pair = .{};
    try pair.init(.{ .keep_alive_ms = 7 }, .{});
    defer pair.deinit();
    _ = try connectPair(&pair);
    const before = pair.client.nextDeadlineNs().?;
    try std.testing.expect(before <= pair.now.nanos() + 7 * std.time.ns_per_ms);
    pair.advance(7);
    try std.testing.expect(pair.client.nextDeadlineNs().? <= pair.now.nanos());
}

test "engine outgoing descriptor preserves native monotonic pacing timestamp" {
    const binding = @import("binding.zig");
    if (!binding.native_pacing_supported) return error.SkipZigTest;
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const before = std.Io.Clock.awake.now(std.testing.io).nanoseconds;
    const handle = try pair.dial();
    var bytes: [constants.datagram_size_max]u8 = undefined;
    const sent = pair.client.sendOne(handle.index, pair.now, &bytes).?;
    const after = std.Io.Clock.awake.now(std.testing.io).nanoseconds;
    try std.testing.expect(sent.bytes.len > 0);
    try std.testing.expect(sent.transmit_at_ns >= before);
    try std.testing.expect(sent.transmit_at_ns <= after);
}

test "engine resources distinguish handshake direction and retain closed slots until retirement" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    try std.testing.expectEqualDeep(Engine.Resources{ .active = 0, .handshaking = 0, .dialing = 0 }, pair.client.resourceSnapshot());

    const inbound = try admitSource(&pair.server, &pair.client, &client_address);
    try std.testing.expectEqualDeep(Engine.Resources{ .active = 1, .handshaking = 0, .dialing = 1 }, pair.client.resourceSnapshot());
    try std.testing.expectEqualDeep(Engine.Resources{ .active = 1, .handshaking = 1, .dialing = 0 }, pair.server.resourceSnapshot());
    try pair.pump();
    try std.testing.expectEqualDeep(Engine.Resources{ .active = 1, .handshaking = 0, .dialing = 0 }, pair.client.resourceSnapshot());
    try std.testing.expectEqualDeep(pair.client.resourceSnapshot(), pair.server.resourceSnapshot());

    try std.testing.expect(pair.server.failSend(inbound));
    try std.testing.expectEqualDeep(Engine.Resources{ .active = 1, .handshaking = 0, .dialing = 0 }, pair.server.resourceSnapshot());
    var events: [8]Event = undefined;
    const count = pair.server.pollEvents(&events);
    try std.testing.expect(count > 0);
    try std.testing.expect(events[count - 1] == .closed);
    try std.testing.expectEqual(@as(u16, 1), pair.server.resourceSnapshot().active);
    pair.server.releaseReported();
    try std.testing.expectEqualDeep(Engine.Resources{ .active = 0, .handshaking = 0, .dialing = 0 }, pair.server.resourceSnapshot());
}

test "engine stopped admission rejects both initial flights without allocating" {
    for ([_]bool{ false, true }) |validated| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        var packet: [constants.datagram_size_max]u8 = undefined;
        var response: [constants.datagram_size_max]u8 = undefined;
        const initial = if (validated) try dialValidatedInitial(&pair, &packet) else try dialInitial(&pair, &packet);
        pair.server.stopAdmission();
        pair.server.stopAdmission();
        const before = pair.server.resourceSnapshot();
        const random = pair.server.csprng;
        try std.testing.expectEqual(.dropped, pair.server.receive(initial, &client_address, pair.now, &response));
        try std.testing.expectError(error.Stopped, pair.server.dial(&client_address, pair.client_ctx.local_peer_id, pair.now));
        pair.server.closeAll();
        try std.testing.expectEqual(.dropped, pair.server.receive(initial, &client_address, pair.now, &response));
        try std.testing.expectEqualDeep(before, pair.server.resourceSnapshot());
        try std.testing.expectEqualDeep(random, pair.server.csprng);
    }
}

test "engine stopped admission preserves streams and close progress on existing routes" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    pair.client.stopAdmission();
    pair.server.stopAdmission();
    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 7), try pair.client.write(stream, "goodbye", true));
    try pair.pump();
    var events: [8]Event = undefined;
    const inbound = try support.expectStreamOpened(pair.events(&pair.server, &events)[0], handles.server);
    var bytes: [7]u8 = undefined;
    const read = try pair.server.read(inbound, &bytes);
    try std.testing.expectEqualStrings("goodbye", bytes[0..read.len]);
    try std.testing.expect(read.fin);
    try std.testing.expect(pair.server.close(handles.server, 0));
    try pair.pump();
    const closed = pair.events(&pair.client, &events);
    try std.testing.expect(closed.len > 0);
    try std.testing.expect(closed[closed.len - 1] == .closed);
}

test "engine prefix admission leaves handshake room for an unrelated network" {
    var server = try initAdmissionEngine(&.{ server_address, server_ip6 }, 1);
    defer server.deinit();
    server.limits.handshaking_per_prefix_max = 1;
    var first_client = try initAdmissionEngine(&.{ client_address, null }, 2);
    defer first_client.deinit();
    _ = try admitSource(&server, &first_client, &client_address);
    var neighbor = client_address;
    neighbor.ip4.octets[3] += 1;
    var second_client = try initAdmissionEngine(&.{ neighbor, null }, 3);
    defer second_client.deinit();
    const handle = try second_client.dial(&server_address, server.tls.local_peer_id, admission_now);
    var packet: [constants.datagram_size_max]u8 = undefined;
    var response: [constants.datagram_size_max]u8 = undefined;
    const initial = second_client.sendOne(handle.index, admission_now, &packet).?;
    try std.testing.expect(server.receive(initial.bytes, &neighbor, admission_now, &response) == .dropped);
    neighbor.ip4.octets[2] +%= 1;
    try std.testing.expect(server.receive(initial.bytes, &neighbor, admission_now, &response) == .retry);
    try std.testing.expectEqual(@as(u16, 1), server.registry.handshaking);
}
