const std = @import("std");
const Now = @import("../types.zig").Now;
const p = @import("topic_policy.zig");
const Gossipsub = @import("Gossipsub.zig");
const Pair = @import("test_pair.zig").Pair;
const validation = @import("validation.zig");
const support = @import("test_support.zig");
const name = "/eth2/01020304/beacon_block/ssz_snappy";
const unknown = "/eth2/01020304/voluntary_exit/ssz_snappy";
const SessionRef = @import("sessions.zig").SessionRef;
const constants = @import("constants.zig");
const messages = @import("messages.zig");
const turn = @import("turn.zig");
const snappy = @import("snappy");
const session_io = @import("session_io.zig");
const topic_mod = @import("topic.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const topic_fixture = @import("topic_fixture.zig");

fn boundary() p.Boundary {
    var b: p.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    b.rules[0] = .{ .count = 1, .ssz_min = 10, .ssz_max = 20 };
    return b;
}
fn options(boundaries: []const p.Boundary) Gossipsub.Options {
    var out: Gossipsub.Options = .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1, .seen_capacity = 16, .mcache_capacity = 16, .validation_capacity = 8 };
    out.topic_policy = boundaries;
    return out;
}
fn live(g: *const Gossipsub) usize {
    var count: usize = 0;
    for (g.overlay.rows) |row| if (row.active) {
        count += 1;
    };
    return count;
}

test "topic policy remembers real inactive subscriptions without event pressure then delivers" {
    var pair: Pair = .{};
    try pair.initOpts(.{ .random_seed = 1 }, options(&.{boundary()}));
    defer pair.deinit();
    try support.subscribe(pair.shared.client.gossipsub, name);
    try support.subscribe(pair.shared.client.gossipsub, unknown);
    for (0..20) |_| try pair.pumpOnce();
    try std.testing.expectEqual(@as(usize, 0), live(pair.shared.server.gossipsub));
    try std.testing.expectEqual(@as(u64, 0), pair.shared.server.gossipsub.counters.local_pressure_resets);
    _ = support.activate(pair.shared.server.gossipsub, name).?;
    const t = pair.shared.server.gossipsub.overlay.findTopic(name).?;
    try std.testing.expectEqual(@as(usize, 1), pair.shared.server.gossipsub.overlay.subscribers(t).count());
    try support.subscribe(pair.shared.server.gossipsub, name);
    const result = try pair.shared.server.gossipsub.publishWithOptions(name, "0123456789", .{ .allow_zero_peers = false }, pair.shared.pair.now);
    try std.testing.expectEqual(@as(usize, 1), result.queued);
    var delivered = false;
    for (0..20) |_| {
        try pair.pumpOnce();
        for (pair.clientMessages()) |message| {
            try std.testing.expectEqualStrings("0123456789", message.bytes);
            delivered = true;
        }
    }
    try std.testing.expect(delivered);
    try support.unsubscribe(pair.shared.client.gossipsub, name);
    for (0..20) |_| try pair.pumpOnce();
    try std.testing.expectEqual(@as(usize, 0), pair.shared.server.gossipsub.overlay.subscribers(t).count());
    try std.testing.expect(!pair.shared.server.gossipsub.overlay.subscribers(0).isSet(0));
}

test "gossip accepted mesh membership does not invent a declared subscription across retirement" {
    const config = options(&.{boundary()});
    var g = try support.init(std.testing.allocator, config);
    defer g.deinit();
    try support.subscribe(&g, name);
    const topic = g.overlay.findTopic(name).?;
    const grafted = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const declared = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    support.control(&g, grafted.index, .{ .graft = name }, now);
    support.control(&g, declared.index, .{ .subscription = .{ .topic = name, .subscribe = true } }, now);
    try std.testing.expect(g.overlay.inMesh(topic, grafted.index));
    try std.testing.expect(!g.overlay.subscribers(topic).isSet(grafted.index));
    try std.testing.expect(g.overlay.subscribers(topic).isSet(declared.index));
    var context = g.overlayContext(now.millis());
    g.overlay.maintain(&context, topic);
    try std.testing.expect(g.overlay.inMesh(topic, grafted.index));
    try std.testing.expect(g.overlay.publicationRecipients(&context, topic, false).isSet(grafted.index));
    try std.testing.expect(!g.overlay.publicationRecipients(&context, topic, true).isSet(grafted.index));
    support.control(&g, grafted.index, .{ .subscription = .{ .topic = name, .subscribe = false } }, now);
    try std.testing.expect(!g.overlay.inMesh(topic, grafted.index));
    g.overlay.maintain(&context, topic);
    try std.testing.expect(!g.overlay.inMesh(topic, grafted.index));
    try std.testing.expect(!g.overlay.gossipRecipients(&context, topic, 1).isSet(grafted.index));
    try support.unsubscribe(&g, name);
    try std.testing.expect(!g.overlay.maintainFanout(&context, topic, true).isSet(grafted.index));
    for ([_]SessionRef{ grafted, declared }) |peer| g.cancelWrites(peer);
    g.last_now_ms = 1 + @max(g.options.retained_score_ms, constants.prune_backoff_ms, constants.fanout_ttl_ms);
    context = g.overlayContext(g.last_now_ms);
    _ = g.overlay.maintainFanout(&context, topic, false);
    g.overlay.expireTopic(&context, topic, g.messages.validation.retainsTopic(topic));
    try std.testing.expect(!g.overlay.rows[topic].active);
    try support.subscribe(&g, name);
    const replacement = g.overlay.findTopic(name).?;
    try std.testing.expect(!g.overlay.subscribers(replacement).isSet(grafted.index));
    try std.testing.expect(g.overlay.subscribers(replacement).isSet(declared.index));
    g.overlay.maintain(&context, replacement);
    try std.testing.expect(!g.overlay.inMesh(replacement, grafted.index));
    try std.testing.expect(g.overlay.inMesh(replacement, declared.index));
}

test "topic policy incoming lengths precede decode work arena store and validation admission" {
    var g = try support.init(std.testing.allocator, options(&.{boundary()}));
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try support.subscribe(&g, name);
    const context = g.messageContext();
    const source: messages.Source = .{ .peer = g.sessions.rows[peer.index].logical, .session = g.sessions.ref(peer.index), .connection = g.sessions.rows[peer.index].conn };
    var peer_work: usize = g.options.decompress_per_peer_bytes;
    var work: usize = 10000;
    var large_used = false;
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    const workspace: turn.Workspace = .{ .scratch = g.msg_scratch, .peer_work = &peer_work, .work = &work, .large_used = &large_used, .sink = g.message_sink };
    var compressed: [100]u8 = undefined;
    const payload: [21]u8 = @splat('x');
    for ([_]usize{ 9, 21 }) |size| {
        const len = try snappy.raw.compress(payload[0..size], &compressed);
        try std.testing.expectEqual(messages.Received{ .invalid = .ssz_size }, g.messages.receive(&context, &workspace, &source, .{ .topic = name, .data = compressed[0..len] }, 1));
        try std.testing.expectEqual(messages.Received{ .invalid = .ssz_size }, g.messages.receive(&context, &workspace, &source, .{ .topic = name, .data = &.{@intCast(size)} }, 1));
        try std.testing.expectEqual(g.options.decompress_per_peer_bytes, peer_work);
        try std.testing.expectEqual(@as(usize, 10000), work);
        try std.testing.expect(!large_used);
        try std.testing.expectEqual(@as(usize, 0), g.messages.store.used_entries);
        for (g.messages.validation.entries) |entry| try std.testing.expect(entry.state == .free);
    }
    for ([_]usize{ 10, 20 }) |size| {
        const len = try snappy.raw.compress(payload[0..size], &compressed);
        const received = g.messages.receive(&context, &workspace, &source, .{ .topic = name, .data = compressed[0..len] }, 1);
        try std.testing.expect(received == .admitted);
        try std.testing.expectEqualSlices(u8, payload[0..size], inbox.last().bytes);
        _ = g.report(inbox.last().handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    }
    try std.testing.expect(peer_work < g.options.decompress_per_peer_bytes);
}

test "topic policy local publication enforces both size bounds before state" {
    var g = try support.init(std.testing.allocator, options(&.{boundary()}));
    defer g.deinit();
    try std.testing.expectError(error.PayloadTooLarge, g.publish(name, "012345678901234567890", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), live(&g));
    try std.testing.expectEqual(@as(usize, 0), g.messages.store.used_entries);
    try std.testing.expectError(error.UnknownTopic, g.publish(unknown, "", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    try std.testing.expectError(error.InvalidTopic, support.subscribe(&g, unknown));
    try std.testing.expectEqual(@as(usize, 0), live(&g));
    try std.testing.expectError(error.PayloadTooSmall, g.publish(name, "short", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), live(&g));
    _ = try g.publish(name, "0123456789", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 1), g.messages.store.used_entries);
    try std.testing.expectError(error.Duplicate, g.publish(name, "0123456789", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
}

test "topic policy physical close clears bits while same connection stream replacement preserves them" {
    var pair: Pair = .{};
    try pair.initOpts(.{ .random_seed = 1 }, options(&.{boundary()}));
    defer pair.deinit();
    try support.subscribe(pair.shared.client.gossipsub, name);
    for (0..20) |_| try pair.pumpOnce();
    const index = pair.shared.server.gossipsub.sessions.find(pair.shared.handles.server).?;
    const overlay = pair.shared.server.gossipsub.overlay;
    try std.testing.expect(overlay.subscribers(0).isSet(index));
    session_io.resetInbound(pair.shared.server.gossipsub, &pair.shared.pair.server, index);
    session_io.resetOutbound(pair.shared.server.gossipsub, &pair.shared.pair.server, index);
    try std.testing.expect(overlay.subscribers(0).isSet(index));
    for (0..20) |_| try pair.pumpOnce();
    const client_index = pair.shared.client.gossipsub.sessions.find(pair.shared.handles.client).?;
    const replacement_stream = try pair.shared.client.router.beginOutbound(&pair.shared.pair.client, pair.shared.handles.client, .{ .meshsub = .v1_1 }, pair.shared.pair.now);
    pair.shared.client.gossipsub.sessions.setOutbound(client_index, .{ .negotiating = replacement_stream });
    for (0..20) |_| try pair.pumpOnce();
    try std.testing.expect(pair.shared.server.gossipsub.sessions.rows[index].in_stream != null);
    try std.testing.expect(pair.shared.server.gossipsub.sessions.rows[index].outbound == .live);
    try std.testing.expect(overlay.subscribers(0).isSet(index));
    var stale = pair.shared.handles.server;
    stale.generation += 1;
    pair.shared.server.gossipsub.connectionClosed(stale);
    try std.testing.expect(overlay.subscribers(0).isSet(index));
    const other = support.addPeer(pair.shared.server.gossipsub, .{ .index = 77, .generation = 1 }, .v1_2).?;
    _ = overlay.peerSubscription(&pair.shared.server.gossipsub.overlayContext(pair.shared.pair.now.millis()), other.index, name, true);
    pair.shared.server.gossipsub.connectionClosed(pair.shared.handles.server);
    try std.testing.expect(!overlay.subscribers(0).isSet(index));
    try std.testing.expect(overlay.subscribers(0).isSet(other.index));
    const replacement = support.addPeer(pair.shared.server.gossipsub, stale, .v1_2).?;
    try std.testing.expectEqual(index, replacement.index);
    try std.testing.expect(!overlay.subscribers(0).isSet(index));
    try support.subscribe(pair.shared.server.gossipsub, name);
    const t = pair.shared.server.gossipsub.overlay.findTopic(name).?;
    try std.testing.expect(!pair.shared.server.gossipsub.overlay.subscribers(t).isSet(index));
    try std.testing.expect(pair.shared.server.gossipsub.overlay.subscribers(t).isSet(other.index));
}

test "topic policy real wire receives only bounded SSZ and keeps borrowed payloads stable" {
    var pair: Pair = .{};
    try pair.initOpts(.{ .random_seed = 1 }, options(&.{boundary()}));
    defer pair.deinit();
    try support.subscribe(pair.shared.server.gossipsub, name);
    try support.subscribe(pair.shared.client.gossipsub, name);
    for (0..20) |_| try pair.pumpOnce();
    var seen: usize = 0;
    const payload: [21]u8 = @splat('z');
    for ([_]usize{ 9, 10, 20, 21 }) |size| {
        const result = try pair.shared.client.gossipsub.publish(name, payload[0..size], pair.shared.pair.now);
        try std.testing.expectEqual(@as(usize, 1), result.queued);
        for (0..20) |_| {
            try pair.pumpOnce();
            for (pair.serverMessages()) |message| {
                try std.testing.expect(size == 10 or size == 20);
                seen += 1;
                const entry = pair.shared.server.gossipsub.messages.validation.attribution(message.handle);
                try std.testing.expectEqual(entry.admitted_ms, message.admitted_ms);
                try std.testing.expectEqual(pair.shared.server.gossipsub.messages.validation.entries[message.handle.index].state.pending.deadline, message.deadline);
                try std.testing.expect(message.identity.eql(&pair.shared.server.gossipsub.peers.rows[entry.source.index].identity));
                try std.testing.expectEqualSlices(u8, payload[0..size], message.bytes);
                try support.subscribe(pair.shared.server.gossipsub, message.topic);
                var local: [10]u8 = @splat('x');
                local[0] = @intCast(size);
                _ = try pair.shared.server.gossipsub.publish(message.topic, &local, pair.shared.pair.now);
                try std.testing.expectEqualStrings(name, message.topic);
                try std.testing.expectEqualSlices(u8, payload[0..size], message.bytes);
                try std.testing.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, pair.shared.server.gossipsub.report(message.handle, .ignore, pair.shared.pair.now));
            }
        }
    }
    try std.testing.expectEqual(@as(usize, 2), seen);
}

test "topic policy all 804 resident names keep the live subscription limit at 512" {
    const boundaries = topic_fixture.hoodi();
    var g = try support.init(std.testing.allocator, options(&boundaries));
    defer g.deinit();
    var buffer: [topic_mod.topic_max_len]u8 = undefined;
    var names: usize = 0;
    for (&boundaries) |*b| {
        inline for (@typeInfo(p.Kind).@"enum".fields) |field| {
            const kind: p.Kind = @enumFromInt(field.value);
            for (0..b.rules[field.value].count) |subnet| {
                var short: [topic_mod.name_max_len]u8 = undefined;
                const part = if (kind.countMax() == 1) field.name else try std.fmt.bufPrint(&short, field.name ++ "_{d}", .{subnet});
                const topic_name = topic_mod.build(b.digest, part, &buffer);
                try std.testing.expect(g.overlay.namespace.lookup(topic_name) != null);
                if (names < 512) {
                    try support.subscribe(&g, topic_name);
                } else {
                    try std.testing.expectEqual(@as(?u16, @intCast(names)), support.activate(&g, topic_name));
                    try std.testing.expectError(error.TopicCapacity, support.subscribe(&g, topic_name));
                }
                names += 1;
            }
        }
    }
    try std.testing.expectEqual(@as(usize, 804), names);
    try std.testing.expectEqual(@as(usize, 804), live(&g));
    for (g.overlay.rows, 0..) |row, i| {
        try std.testing.expectEqual(i < 512, row.subscribed);
    }
}

test "topic policy copied startup allocation prefixes and whole owner memory reconcile" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, startup, .{});
    var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
    var boundaries = topic_fixture.hoodi();
    var g = try support.init(ledger.allocator(), options(&boundaries));
    defer g.deinit();
    const ns = &g.overlay.namespace;
    try std.testing.expectEqual(g.memoryPlan().total_bytes - @sizeOf(Gossipsub), ledger.bytes);
    try std.testing.expect(g.options.topic_policy.len == 0);
    boundaries[0].digest = @splat(0);
    boundaries[0].rules[0].ssz_max = 1;
    try std.testing.expectEqual(@as(u32, 100), ns.lookup("/eth2/d2f1997f/beacon_block/ssz_snappy").?.rule.ssz_max);
}

fn startup(a: std.mem.Allocator) !void {
    const boundaries = topic_fixture.hoodi();
    var g = try support.init(a, options(&boundaries));
    defer g.deinit();
    try std.testing.expectEqual(@as(u16, 804), g.overlay.namespace.topic_count);
}
