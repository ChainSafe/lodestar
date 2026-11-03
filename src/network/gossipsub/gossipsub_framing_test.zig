const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const Engine = @import("../quic/Engine.zig");
const digest = topic_mod.ForkDigest{ 0x6a, 0x95, 0xa1, 0xa9 };
const Pair = @import("test_pair.zig").Pair;
const Penalty = @import("score.zig").Penalty;
const constants_heartbeat = @import("constants.zig").heartbeat_interval_ms;
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const MessageId = Gossipsub.MessageId;
const constants = @import("constants.zig");
const protobuf = @import("protobuf.zig");
const Handle = Engine.Handle;
const Now = @import("../types.zig").Now;
const snappy = @import("snappy");
const receive_pool = @import("receive_pool.zig");
const IwantOutcome = @import("metrics.zig").IwantOutcome;
const topic_fixture = @import("topic_fixture.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const frame = @import("frame.zig");
const session_io = @import("session_io.zig");
const turn_mod = @import("turn.zig");

fn buildTopic(name: []const u8, out: []u8) []const u8 {
    return topic_mod.build(digest, name, out);
}

fn feedPagedTestFrame(g: *Gossipsub, index: u16, wire: []const u8) !void {
    const io = &g.sessions.rows[index].io;
    var offset: usize = 0;
    for (0..wire.len + 1) |_| {
        if (offset == wire.len) return;
        const take = @min(io.unread.len, wire.len - offset);
        @memcpy(io.unread[0..take], wire[offset..][0..take]);
        io.unread_start = 0;
        io.unread_end = take;
        for (0..take + 1) |_| {
            if (io.unread_start == io.unread_end) break;
            const result = try io.feedUnread(&g.sessions.receive_pool, io.unread_end - io.unread_start, 1);
            try std.testing.expect(result.consumed > 0);
        }
        offset += take;
    }
    unreachable;
}

test "gossipsub receives a message larger than the per-peer body buffer" {
    var setup: Pair = .{};
    // the server holds a tiny per-peer body buffer, so the message must be read
    // through a claimed large-pool buffer instead
    try setup.initOpts(.{
        .random_seed = 1,
    }, .{ .random_seed = 1, .body_buffer_bytes = 1024 });
    defer setup.deinit();

    var buf: [topic_mod.topic_max_len]u8 = undefined;
    const beacon_block = buildTopic("beacon_block", &buf);
    try support.subscribe(setup.shared.client.gossipsub, beacon_block);
    try support.subscribe(setup.shared.server.gossipsub, beacon_block);

    var rounds: usize = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();
    setup.shared.pair.advance(constants_heartbeat + 100);
    rounds = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();

    // a poorly-compressible 8 KB payload: its compressed frame exceeds 1 KB
    var payload: [8192]u8 = undefined;
    for (&payload, 0..) |*byte, i| byte.* = @intCast((i * 131 + 7) & 0xff);
    _ = try setup.shared.client.gossipsub.publish(beacon_block, &payload, setup.shared.pair.now);

    var received = false;
    rounds = 0;
    while (rounds < 20 and !received) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverMessages()) |m| {
            try std.testing.expectEqualSlices(u8, &payload, m.bytes);
            _ = setup.shared.server.gossipsub.report(m.handle, .accept, setup.shared.pair.now);
            received = true;
        }
    }
    try std.testing.expect(received);
}

test "gossipsub receive page exhaustion discards only the requesting frame without blame" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1, .body_buffer_bytes = 1024, .receive_arena_bytes = 16 * 1024 * 1024 });
    defer setup.deinit();
    try setup.connectMesh();
    const g = setup.shared.server.gossipsub;
    var held: [3]receive_pool.Chain = @splat(.{});
    defer for (&held) |*chain| g.sessions.receive_pool.release(chain);
    for (0..g.sessions.receive_pool.next.len) |i| {
        const chain = &held[i % held.len];
        _ = g.sessions.receive_pool.writable(chain).?;
        chain.len += receive_pool.page_bytes;
    }
    const peer = g.sessions.find(setup.shared.handles.server).?;
    const logical = g.sessions.rows[peer].logical;
    const before = g.peers.score(logical, setup.shared.pair.now.millis());
    var payload: [65536]u8 = undefined;
    var rng = std.Random.DefaultPrng.init(113);
    rng.random().bytes(&payload);
    _ = try setup.shared.client.gossipsub.publish(test_topic, &payload, setup.shared.pair.now);
    for (0..64) |_| try setup.pumpOnce();
    try std.testing.expect(!g.messages.known(topic_mod.validMessageId(test_topic, &payload, .{}), setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(usize, 0), setup.serverMessages().len);
    try std.testing.expectEqual(@as(u64, 0), g.counters.local_pressure_resets);
    try std.testing.expectEqual(@as(u64, 0), g.counters.malformed_rpcs);
    try std.testing.expectEqual(before, g.peers.score(logical, setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(u64, 0), g.peers.rows[logical.index].large_frame_denied_until);
    for (g.peers.scores.penalties) |count| try std.testing.expectEqual(@as(u64, 0), count);
    try std.testing.expect(g.sessions.rows[peer].in_stream != null);
    try std.testing.expect(g.sessions.rows[peer].outStream() != null);
    try std.testing.expect(g.sessions.rows[peer].io.reader.declaredLen() == null);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.receive_pool.free_pages);
    const inbound = g.sessions.rows[peer].in_stream.?;
    _ = try setup.shared.client.gossipsub.publish(test_topic, "after discarded frame", setup.shared.pair.now);
    var received = false;
    for (0..32) |_| {
        try setup.pumpOnce();
        for (setup.serverMessages()) |message| {
            try std.testing.expectEqualStrings("after discarded frame", message.bytes);
            received = true;
        }
        if (received) break;
    }
    try std.testing.expect(received);
    try std.testing.expectEqual(inbound, g.sessions.rows[peer].in_stream.?);
}

test "gossipsub graylist refuses bulk reception and releases an idle partial frame" {
    for ([_]bool{ false, true }) |partial| {
        var setup: Pair = .{};
        try setup.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1, .body_buffer_bytes = 64 });
        defer setup.deinit();
        for (0..16) |_| try setup.pumpOnce();
        const g = setup.shared.server.gossipsub;
        const index = g.sessions.find(setup.shared.handles.server).?;
        const row = &g.sessions.rows[index];
        var wire: [1024]u8 = undefined;
        var writer = protobuf.Writer.init(&wire);
        writer.varint(constants.GOSSIP_MAX_SIZE);
        writer.bytes(&([_]u8{0} ** 128));
        if (!partial) support.penalize(g, row.conn, 50);
        try std.testing.expectEqual(writer.len, try setup.shared.pair.client.write(setup.clientStream(), writer.written(), false));
        for (0..8) |_| try setup.pumpOnce();
        if (partial) {
            try std.testing.expect(row.io.overflow.pages > 0);
            try std.testing.expect(!row.io.rx_ready);
            support.penalize(g, row.conn, 50);
            // The next heartbeat finds the graylisted session holding a frame.
            setup.shared.pair.advance(constants_heartbeat);
            try setup.pumpOnce();
        }
        try std.testing.expect(row.in_stream == null and row.io.rpc == null);
        try std.testing.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
        try std.testing.expectEqual(@as(u64, 0), g.counters.malformed_rpcs);
        try std.testing.expectEqual(@as(f64, 50), g.peers.scores.rows[row.logical.index].behaviour);
    }
}

test "gossipsub malformed framing and RPCs penalize authenticated sources across stream resets" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1, .score_params = .{ .behaviour_threshold = 0 } });
    defer setup.deinit();
    for (0..16) |_| try setup.pumpOnce();
    const g = setup.shared.server.gossipsub;
    const index = g.sessions.find(setup.shared.handles.server).?;
    const row = &g.sessions.rows[index];
    const source = row.logical;
    const malformed = [_][]const u8{
        &.{ 2, 0x08, 0 },
        &.{ 0x80, 0x00 },
    };
    for (malformed, 0..) |wire, i| {
        try std.testing.expectEqual(wire.len, try setup.shared.pair.client.write(setup.clientStream(), wire, false));
        for (0..32) |_| {
            try setup.pumpOnce();
            if (g.counters.malformed_rpcs == i + 1) break;
        }
        try std.testing.expectEqual(i + 1, g.counters.malformed_rpcs);
        try std.testing.expect(row.in_stream == null);
        try std.testing.expectEqual(source, row.logical);
        try std.testing.expectEqual(@as(f64, @floatFromInt(i + 1)), g.peers.scores.rows[source.index].behaviour);
        try std.testing.expect(g.peers.score(source, setup.shared.pair.now.millis()) < 0);
        try std.testing.expectEqual(@as(f64, 0), support.invalidDeliveries(g));
        try std.testing.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
        for (0..16) |_| try setup.pumpOnce();
        if (i + 1 < malformed.len) {
            const client = setup.shared.client.gossipsub;
            const client_index = client.sessions.find(setup.shared.handles.client).?;
            try std.testing.expectEqual(.none, client.sessions.rows[client_index].outbound);
            client.sessions.setOutbound(client_index, .pending);
            for (0..16) |_| try setup.pumpOnce();
            try std.testing.expect(client.sessions.rows[client_index].outStream() != null);
        }
    }
    try std.testing.expectEqual(@as(u64, 1), g.peers.scores.penalties[@intFromEnum(Penalty.malformed_rpc)]);
    try std.testing.expectEqual(@as(u64, 1), g.peers.scores.penalties[@intFromEnum(Penalty.malformed_frame)]);
}

test "gossip graylist drops an RPC before decoding or admitting messages" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const session = support.addPeer(&g, conn, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    support.penalize(&g, conn, 50);
    // An accepting host: a message that got past the graylist would be delivered.
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var encoded: [256]u8 = undefined;
    var compressed: [64]u8 = undefined;
    const len = try snappy.raw.compress("payload", &compressed);
    var writer = protobuf.Writer.init(&encoded);
    protobuf.writeMessage(&writer, compressed[0..len], name);
    g.sessions.rows[session.index].io.startRpc(writer.written());
    var count: usize = 0;
    var items = g.options.items_per_peer;
    try std.testing.expect(try support.processRpc(&g, session.index, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }), &count, &items));
    // The graylist ends the RPC before it takes an item credit or decodes a field.
    try std.testing.expectEqual(g.options.items_per_peer, items);
    try std.testing.expectEqual(@as(usize, 0), inbox.count);
    try std.testing.expectEqual(@as(usize, 0), g.messages.seen.count);
}

test "gossip IWANT admits 5000 IDs and rejects larger envelopes before service" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    for ([_]usize{ constants.max_iwant_ids_per_rpc, constants.max_iwant_ids_per_rpc + 1 }) |count| {
        const encoded = try std.testing.allocator.alloc(u8, protobuf.iwantRpcSize(count, constants.message_id_length));
        defer std.testing.allocator.free(encoded);
        var writer = protobuf.Writer.init(encoded);
        protobuf.beginIwantRpc(&writer, count, constants.message_id_length);
        const id: MessageId = @splat(0xab);
        for (0..count) |_| protobuf.writeIwantId(&writer, &id);
        const io = &g.sessions.rows[session.index].io;
        io.startRpc(writer.written());
        var emitted: usize = 0;
        var items = g.options.items_per_peer;
        const result = support.processRpc(&g, session.index, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }), &emitted, &items);
        if (count == constants.max_iwant_ids_per_rpc) {
            try std.testing.expect(try result);
        } else {
            try std.testing.expectError(error.OccurrenceLimit, result);
        }
        try std.testing.expectEqual(@as(u64, constants.max_iwant_ids_per_rpc), g.iwant_outcomes[@intFromEnum(IwantOutcome.miss)]);
        try std.testing.expectEqual(@as(usize, 0), emitted);
        _ = g.sessions.finishFrame(io);
    }
}

test "gossip independent RPC enumerates every receive split through admission" {
    // RPC 17.1.1, it-length-prefixed 11.0.1 and Snappy 7.3.3 encoded this two-message fixture.
    const wire = @embedFile("testdata/independent-two.rpc");
    const name = "/eth2/01000000/beacon_block/ssz_snappy";
    try std.testing.expect(wire[0] & 0x80 != 0);
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
        .mcache_capacity = 2,
        .validation_capacity = 4,
        .seen_capacity = 2,
        .seen_ttl_ms = 1,
        .validation_tombstone_ms = 1,
        .body_buffer_bytes = 1,
        .topic_policy = &.{topic_fixture.bytes(.{ 1, 0, 0, 0 })},
    });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try support.subscribe(&g, name);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var expected: [2][64]u8 = undefined;
    for (0..64) |i| {
        expected[0][i] = @intCast(i);
        expected[1][i] = @intCast(255 - i);
    }
    for (0..wire.len + 1) |split| {
        const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1 + split * 10, .unix_s = 1 });
        g.last_now_ms = now.millis();
        g.messages.validation.expire(&g.messages.store, &g.peers, now.millis());
        const io = &g.sessions.rows[peer.index].io;
        try std.testing.expect(!g.sessions.resetRx(peer.index));
        var count: usize = 0;
        var consumed: usize = 0;
        var items: usize = 128;
        for ([_][]const u8{ wire[0..split], wire[split..] }) |fragment| {
            try std.testing.expect(g.sessions.receiveHandoff(peer.index, fragment, false));
            for (0..wire.len + 1) |_| {
                if (io.unread_start == io.unread_end) break;
                const result = try io.feedUnread(&g.sessions.receive_pool, io.unread_end - io.unread_start, now.millis());
                try std.testing.expect(result.consumed > 0);
                consumed += result.consumed;
                if (result.complete) {
                    try std.testing.expect(try support.processRpc(&g, peer.index, now, &count, &items));
                    try std.testing.expect(try support.processRpc(&g, peer.index, now, &count, &items));
                    try std.testing.expect(g.sessions.finishFrame(io));
                }
            }
        }
        try std.testing.expectEqual(wire.len, consumed);
        try std.testing.expectEqual(@as(usize, 2), count);
        for (inbox.messages(), 0..) |message, i| {
            try std.testing.expectEqualSlices(u8, &expected[i], message.bytes);
            try std.testing.expect(g.report(message.handle, .ignore, now) == .applied);
        }
        inbox.clear();
        try std.testing.expect(io.rpc == null and io.reader.declaredLen() == null);
        try std.testing.expectEqual(io.unread_end, io.unread_start);
        const snapshot = g.resourceSnapshot();
        try std.testing.expectEqual(@as(usize, 0), snapshot.pending_validations);
        try std.testing.expectEqual(@as(usize, 0), snapshot.store_entries);
        try std.testing.expectEqual(@as(usize, 0), snapshot.store_pages);
    }
}

test "gossip paged RPC cursors survive shared workspace reuse without runtime allocation" {
    var backing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var ledger: CountingAllocator = .{ .backing = backing.allocator() };
    var g = try support.init(ledger.allocator(), .{
        .random_seed = 1,
        .connected_capacity = 4,
        .retained_capacity = 17,
        .retained_outbound_reserve = 1,
        .body_buffer_bytes = 2,
    });
    defer g.deinit();
    const calls = backing.allocations;
    ledger.byte_limit = ledger.bytes;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    for (0..4) |i| {
        const peer = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        try std.testing.expectEqual(i, peer.index);
    }
    var prefix: [8]u8 = undefined;
    var pw = protobuf.Writer.init(&prefix);
    pw.varint(constants.GOSSIP_MAX_SIZE);
    for (0..2) |i| try feedPagedTestFrame(&g, @intCast(i), pw.written());
    try std.testing.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
    for (0..2) |i| try feedPagedTestFrame(&g, @intCast(i), "slow");
    try std.testing.expectEqual(g.sessions.receive_pool.next.len - 2, g.sessions.receive_pool.free_pages);

    var payloads: [4][6000]u8 = undefined;
    var rng = std.Random.DefaultPrng.init(947);
    for (&payloads) |*payload| rng.random().bytes(payload);
    var compressed: [8192]u8 = undefined;
    var body: [16384]u8 = undefined;
    var wire: [16388]u8 = undefined;
    for (0..2) |i| {
        var writer = protobuf.Writer.init(&body);
        for (0..2) |j| {
            const len = try snappy.raw.compress(&payloads[i * 2 + j], &compressed);
            protobuf.writeMessage(&writer, compressed[0..len], name);
        }
        try feedPagedTestFrame(&g, @intCast(i + 2), frame.writeFrame(&wire, writer.written()));
        try std.testing.expect(g.sessions.rows[i + 2].io.rpc != null);
    }
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 1 });
    for (0..2) |round| {
        for (0..2) |i| {
            var count: usize = 0;
            // One item credit pauses each RPC after its first message; two finish it.
            var items: usize = 1 + round;
            const done = try support.processRpc(&g, @intCast(i + 2), now, &count, &items);
            try std.testing.expectEqual(round == 1, done);
            try std.testing.expectEqual(@as(usize, 1), count);
            try std.testing.expectEqualSlices(u8, &payloads[i * 2 + round], inbox.last().bytes);
            @memset(g.sessions.decode_scratch, 0xa5);
            try std.testing.expectEqualSlices(u8, &payloads[i * 2 + round], inbox.last().bytes);
            _ = g.report(inbox.last().handle, .ignore, now);
            if (done) _ = g.sessions.finishFrame(&g.sessions.rows[i + 2].io);
        }
    }
    for (0..2) |i| try std.testing.expect(g.sessions.resetRx(@intCast(i)));
    try std.testing.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
    try std.testing.expectEqual(calls, backing.allocations);
}

test "gossip invalid verdict stops remaining publications in the same RPC" {
    var opts: Gossipsub.Options = .{
        .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })},
        .random_seed = 1,
        .connected_capacity = 4,
        .retained_capacity = 17,
        .retained_outbound_reserve = 1,
        .body_buffer_bytes = 64,
    };
    opts.score_params.gossip_threshold = -20;
    opts.score_params.publish_threshold = -40;
    opts.score_params.graylist_threshold = -50;
    var g = try support.init(std.testing.allocator, opts);
    defer g.deinit();
    const source = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try support.subscribe(&g, test_topic);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var body: [1024]u8 = undefined;
    var writer = protobuf.Writer.init(&body);
    for (0..3) |_| protobuf.writeMessage(&writer, &.{5}, test_topic);
    const io = &g.sessions.rows[source.index].io;
    io.startRpc(writer.written());
    var turn = Gossipsub.beginPump(&g, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    var credit = turn_mod.Credits.peer(&g.options);
    try std.testing.expectEqual(.done, try session_io.processRpc(&g, source.index, &turn, &credit));
    try std.testing.expectEqual(@as(f64, 1), support.invalidDeliveries(&g));
    _ = g.sessions.finishFrame(io);
}
