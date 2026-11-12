const std = @import("std");
const Now = @import("../types.zig").Now;
const t = std.testing;
const Gossipsub = @import("../gossipsub/Gossipsub.zig");
const processor = @import("root.zig");
const messages = @import("../gossipsub/messages.zig");
const support = @import("../gossipsub/test_support.zig");
const protobuf = @import("../gossipsub/protobuf.zig");
const snappy = @import("snappy");
const block = "/eth2/01020304/beacon_block/ssz_snappy";
const attestation = "/eth2/01020304/beacon_attestation_0/ssz_snappy";
const topic_fixture = @import("../gossipsub/topic_fixture.zig");
const test_pair = @import("../gossipsub/test_pair.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const session_io = @import("../gossipsub/session_io.zig");
const topic_policy = @import("../gossipsub/topic_policy.zig");
const recovery = @import("../gossipsub/recovery.zig");
const turn_mod = @import("../gossipsub/turn.zig");
const topic_mod = @import("../gossipsub/topic.zig");
const frame = @import("../gossipsub/frame.zig");
const options: Gossipsub.Options = .{
    .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })},
    .random_seed = 1,
    .connected_capacity = 4,
    .retained_capacity = 9,
    .retained_outbound_reserve = 1,
    .body_buffer_bytes = 64,
};

const Consumer = struct {
    table: *processor.GossipProcessor,
    slot: u64 = 1,

    fn sink(self: *Consumer) Gossipsub.MessageSink {
        return .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
    }

    fn hasCapacity(context: *anyopaque, kind: processor.limits.Kind, len: usize) bool {
        const self: *Consumer = @ptrCast(@alignCast(context));
        return self.table.checkAdmissionCapacity(kind, len);
    }

    fn admit(context: *anyopaque, candidate: *Gossipsub.MessageAdmission) bool {
        const self: *Consumer = @ptrCast(@alignCast(context));
        return self.table.admit(candidate, candidate.event.admitted_ms, 1, self.slot);
    }
};

fn receive(g: *Gossipsub, source: u16, topic: []const u8, payload: []const u8) !void {
    var compressed: [8192]u8 = undefined;
    const len = try snappy.raw.compress(payload, &compressed);
    var turn = Gossipsub.beginPump(g, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    var credit = turn_mod.Credits.peer(&g.options);
    try t.expectEqual(.done, g.receiveItem(g.sessions.ref(source), .{ .message = .{ .topic = topic, .data = compressed[0..len] } }, &turn, &credit));
}

test "gossip fatal reports preserve unrelated validation through direct processor admission" {
    var opts = options;
    opts.connected_capacity = 18;
    opts.retained_capacity = 37;
    var g = try support.init(t.allocator, opts);
    defer g.deinit();
    const limits: processor.limits.Limits = @splat(.{ .items = 32, .bytes = 8192 });
    var table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    defer g.message_sink = null;
    try support.subscribe(&g, block);
    var tokens: [18]processor.GossipProcessor.Token = undefined;
    for (&tokens, 0..) |*token, i| {
        const peer = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        g.peers.rows[g.logical(peer.index).index].admission_source = .{ .ip4 = .{ 192, 0, 2, @intCast(i / 16) } };
        var payload: [108]u8 = @splat(0);
        payload[0] = @intCast(i);
        std.mem.writeInt(u64, payload[100..108], 1, .little);
        try receive(&g, peer.index, block, &payload);
        const index = table.expiry.tail;
        token.* = .{ .index = @intCast(index), .generation = table.cells[index].generation };
        try t.expect(table.get(token.*).?.source != null);
    }
    try t.expectEqual(tokens.len, g.resourceSnapshot().pending_validations);
    for (tokens[1..]) |token| table.dropPeer(&table.get(token).?.identity);
    for (0..std.math.divCeil(usize, table.cells.len, processor.GossipProcessor.batch_max) catch unreachable) |_| table.maintain(2, 1);
    for (tokens[1..]) |token| {
        const cell = table.get(token).?;
        try t.expectEqual(processor.GossipProcessor.State.completion_pending, cell.state);
        try t.expectEqual(processor.GossipProcessor.Completion.cancelled, cell.completion);
        try t.expect(g.cancel(cell.handle, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
        table.retire(token);
    }
    try t.expectEqual(@as(usize, 1), g.resourceSnapshot().pending_validations);
    var retry: [108]u8 = @splat(0);
    retry[0] = 1;
    std.mem.writeInt(u64, retry[100..108], 1, .little);
    try t.expectEqual(@as(?usize, 1), try support.message(&g, 0, &retry, 2));
    const batch = table.claim(2);
    try t.expectEqual(@as(usize, 2), batch.len);
    try t.expectEqual(tokens[0], batch.tokens[0]);
    table.finish(&batch);
    for (batch.tokens[0..batch.len]) |token| {
        try t.expect(table.report(token, .accept, 2));
        try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(table.get(token).?.handle, .accept, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
        table.retire(token);
    }
    try t.expectEqual(@as(usize, 0), g.resourceSnapshot().pending_validations);
}

test "gossip queue cancellation and validation expiry permit retries while host work stays charged" {
    for ([_]bool{ false, true }) |executing| {
        var opts = options;
        opts.validation_timeout_ms = 10;
        var g = try support.init(t.allocator, opts);
        defer g.deinit();
        const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 8192 });
        var table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
        defer table.deinit();
        defer table.close();
        var consumer: Consumer = .{ .table = &table };
        const sink = consumer.sink();
        g.message_sink = &sink;
        defer g.message_sink = null;
        try support.subscribe(&g, block);
        for (0..2) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        try t.expectEqual(@as(?usize, 1), try support.message(&g, 0, "retry", 1));
        const old_index = table.expiry.tail;
        const old: processor.GossipProcessor.Token = .{ .index = @intCast(old_index), .generation = table.cells[old_index].generation };
        const old_handle = table.get(old).?.handle;
        if (executing) {
            const batch = table.claim(2);
            table.finish(&batch);
            table.expire(11);
            g.messages.expire(&g.peers, 11);
            try t.expectEqual(@as(usize, 1), table.diag.executing);
        } else {
            table.dropQueued();
            try t.expectEqual(@as(usize, 0), table.claim(2).len);
            try t.expectEqual(processor.GossipProcessor.Completion.cancelled, table.get(old).?.completion);
            try t.expect(g.cancel(old_handle, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
            table.retire(old);
        }
        try t.expectEqual(@as(?usize, 1), try support.message(&g, 1, "retry", 12));
        const batch = table.claim(12);
        try t.expectEqual(@as(usize, 1), batch.len);
        table.finish(&batch);
        try t.expectEqual(1 + @as(usize, @intFromBool(executing)), table.diag.executing);
        try t.expect(!table.report(old, .reject, 12));
        try t.expectEqual(@as(usize, 1), table.diag.executing);
        const current = batch.tokens[0];
        try t.expect(table.report(current, .accept, 12));
        try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(table.get(current).?.handle, .accept, Now.fromMilliseconds(.{ .mono_ms = 12, .unix_s = 0 })));
        table.retire(current);
        try t.expectEqual(@as(usize, 0), table.diag.occupied);
    }
}

test "gossip direct processor admission drains paged RPCs while the host queue stays full" {
    var pair: test_pair.Pair = .{};
    try pair.initOpts(options, options);
    defer pair.deinit();
    const g = pair.shared.server.gossipsub;
    try support.subscribe(g, block);
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
    var table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    defer g.message_sink = null;
    for (0..16) |_| try pair.pumpOnce();

    var payloads: [3][6000]u8 = undefined;
    var random = std.Random.DefaultPrng.init(82);
    var compressed: [8192]u8 = undefined;
    var body: [32768]u8 = undefined;
    var writer = protobuf.Writer.init(&body);
    for (&payloads) |*payload| {
        random.random().bytes(payload);
        std.mem.writeInt(u64, payload[100..108], 1, .little);
        const len = try snappy.raw.compress(payload, &compressed);
        protobuf.writeMessage(&writer, compressed[0..len], block);
    }
    var framed: [32776]u8 = undefined;
    const wire = frame.writeFrame(&framed, writer.written());
    const source = g.sessions.find(pair.shared.handles.server).?;
    const row = &g.sessions.rows[source];
    const score = g.peers.score(row.logical, pair.shared.pair.now.millis());
    var sent: usize = 0;
    for (0..128) |_| {
        if (sent < wire.len) sent += pair.shared.pair.client.write(pair.clientStream(), wire[sent..], false) catch |err| switch (err) {
            error.WouldBlock => 0,
            else => return err,
        };
        try pair.pumpOnce();
        if (sent == wire.len and g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.processor_capacity)] > 0 and row.io.rpc == null) break;
    }
    try t.expectEqual(wire.len, sent);
    try t.expectEqual(@as(usize, 2), table.diag.occupied);
    try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.processor_capacity)]);
    try t.expectEqual(@as(usize, 2), g.resourceSnapshot().pending_validations);
    try t.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
    try t.expect(row.io.rpc == null and row.in_stream != null);
    try t.expectEqual(@as(u64, 0), g.counters.local_pressure_resets);
    try t.expectEqual(score, g.peers.score(row.logical, pair.shared.pair.now.millis()));
    @memset(g.msg_scratch, 0xa5);
    @memset(g.sessions.decode_scratch, 0xa5);
    @memset(row.io.body, 0xa5);
    var actual: [6000]u8 = undefined;
    for (table.cells[0..2], 0..) |*cell, i| {
        try t.expectEqual(pair.shared.handles.server, cell.connection);
        try t.expectEqual(pair.shared.pair.server.peerAddress(cell.connection).?, cell.endpoint.?);
        table.copyPayload(cell, &actual);
        try t.expectEqualSlices(u8, &payloads[i], &actual);
    }
}

test "gossip full processor preserves duplicate attribution without runtime allocations" {
    var backing = std.testing.FailingAllocator.init(t.allocator, .{});
    var ledger: CountingAllocator = .{ .backing = backing.allocator() };
    var g = try support.init(ledger.allocator(), options);
    defer g.deinit();
    const limits: processor.limits.Limits = @splat(.{ .items = 2, .bytes = 4096 });
    var table = try processor.GossipProcessor.init(ledger.allocator(), .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    try support.subscribe(&g, block);
    for (0..2) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
    const allocations = backing.allocations;
    ledger.byte_limit = ledger.bytes;
    try receive(&g, 1, block, "filler");
    try receive(&g, 0, block, "pending");
    const handle = table.cells[1].handle;
    try receive(&g, 1, block, "pending");
    try receive(&g, 1, block, "unexamined");
    var turn = Gossipsub.beginPump(&g, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    var credit = turn_mod.Credits.peer(&g.options);
    try t.expectEqual(.done, g.receiveItem(g.sessions.ref(1), .{ .message = .{ .topic = block, .data = &.{7} } }, &turn, &credit));
    try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&g));
    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .reject }, g.report(handle, .reject, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
    try t.expectEqual(@as(f64, 2), support.invalidDeliveries(&g));
    try t.expectEqual(@as(u64, 2), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.processor_capacity)]);
    try t.expectEqual(allocations, backing.allocations);
}

test "gossip saturated attestation intake preserves block priority and storage" {
    var g = try support.init(t.allocator, options);
    defer g.deinit();
    const limits: processor.limits.Limits = @splat(.{ .items = 2, .bytes = 8192 });
    var table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    _ = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try support.subscribe(&g, block);
    try support.subscribe(&g, attestation);
    _ = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    try receive(&g, 0, attestation, "first");
    try receive(&g, 1, attestation, "second");
    try receive(&g, 0, attestation, "refused");
    try receive(&g, 0, block, "urgent");
    try t.expectEqual(@as(usize, 3), table.diag.occupied);
    const batch = table.claimDemand(2, .{ .ordinary = false });
    try t.expectEqual(@as(usize, 1), batch.len);
    try t.expectEqual(.beacon_block, table.get(batch.tokens[0]).?.kind);
    table.finish(&batch);
}

fn vote(bytes: []u8, tag: u8, slot: u64) void {
    @memset(bytes, tag);
    if (bytes.len >= 24) std.mem.writeInt(u64, bytes[16..24], slot, .little);
}

test "gossip admission rejects ineligible candidates without replacing work and commits valid replacements atomically" {
    var opts = options;
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
    var boundary = topic_fixture.bytes(.{ 1, 2, 3, 4 });
    for (&boundary.rules) |*rule| rule.ssz_max = 6000;
    opts.topic_policy = &.{boundary};
    opts.payload_limits = limits;
    opts.validation_capacity = processor.limits.items(&limits);
    var g = try support.init(t.allocator, opts);
    defer g.deinit();
    var table = try processor.GossipProcessor.init(t.allocator, try processor.GossipProcessor.Options.resolve(limits, null, opts.topic_policy, &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }}, opts.random_seed.?));
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    try support.subscribe(&g, attestation);
    for (0..3) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
    var bytes: [240]u8 = undefined;
    for (0..4) |i| {
        vote(&bytes, @intCast(i), 1);
        try receive(&g, @intCast(i / 2), attestation, &bytes);
    }
    const victim = oldestReplaceable(&table);
    const handle = table.get(victim).?.handle;
    const free_pages = g.messages.store.free_pages;
    vote(&bytes, 8, 1);
    try receive(&g, 0, attestation, &bytes);
    try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.peer_validations)]);
    try t.expectEqual(@as(u64, 0), table.diag.cancelled);
    try t.expect(table.get(victim) != null);
    vote(&bytes, 9, 1000);
    try receive(&g, 2, attestation, &bytes);
    try t.expectEqual(@as(u64, 1), table.diag.slotRefusals);
    try t.expectEqual(@as(u64, 1), table.refusals[@intFromEnum(processor.limits.Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.Refusal.ineligible)]);
    try t.expect(table.get(victim) != null);
    try t.expectEqual(@as(usize, 4), g.resourceSnapshot().pending_validations);
    try t.expectEqual(free_pages, g.messages.store.free_pages);
    vote(&bytes, 10, 1);
    try receive(&g, 2, attestation, &bytes);
    try t.expect(table.get(victim) == null);
    try t.expectEqual(@as(u64, 1), table.diag.cancelled);
    try t.expectEqual(@as(u64, 0), g.topic_metrics.get(attestation).ignored);
    try t.expectEqual(@as(usize, 4), table.diag.occupied);
    try t.expectEqual(@as(usize, 4), g.resourceSnapshot().pending_validations);
    try t.expectEqual(Gossipsub.ReportOutcome.stale_handle, g.report(handle, .reject, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
    try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&g));
}

test "gossip admission leaves queued work intact when a host copy pins the required pages" {
    var opts = options;
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 8192 });
    var boundary = topic_fixture.bytes(.{ 1, 2, 3, 4 });
    for (&boundary.rules) |*rule| rule.ssz_max = 6000;
    opts.topic_policy = &.{boundary};
    opts.payload_limits = limits;
    opts.validation_capacity = processor.limits.items(&limits);
    var g = try support.init(t.allocator, opts);
    defer g.deinit();
    var table = try processor.GossipProcessor.init(t.allocator, try processor.GossipProcessor.Options.resolve(limits, null, opts.topic_policy, &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }}, opts.random_seed.?));
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    try support.subscribe(&g, attestation);
    for (0..3) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
    var large: [6000]u8 = undefined;
    vote(&large, 1, 1);
    try receive(&g, 0, attestation, &large);
    const checks = table.claimChecks(1, processor.GossipProcessor.batch_max);
    try t.expectEqual(@as(usize, 1), checks.len);
    try t.expect(table.classify(checks.tokens[0], true));
    table.maintain(60, table.slot);
    const copying = table.claim(60);
    try t.expectEqual(@as(usize, 1), copying.len);
    defer table.finish(&copying);
    var small: [240]u8 = undefined;
    for (0..2) |i| {
        vote(&small, @intCast(i + 2), 1);
        try receive(&g, 1, attestation, &small);
    }
    const victim = oldestReplaceable(&table);
    var candidate: [1000]u8 = undefined;
    vote(&candidate, 4, 1);
    try receive(&g, 2, attestation, &candidate);
    try t.expectEqual(@as(u64, 0), table.diag.cancelled);
    try t.expectEqual(@as(usize, 3), table.diag.occupied);
    try t.expectEqual(@as(usize, 3), g.resourceSnapshot().pending_validations);
    try t.expect(table.get(victim) != null);
    try t.expectEqual(processor.GossipProcessor.State.copying, table.get(copying.tokens[0]).?.state);
}

test "gossip admission after a refused victim selection retires only its own victims" {
    var opts = options;
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 8192 });
    var boundary = topic_fixture.bytes(.{ 1, 2, 3, 4 });
    for (&boundary.rules) |*rule| rule.ssz_max = 6000;
    opts.topic_policy = &.{boundary};
    opts.payload_limits = limits;
    opts.validation_capacity = processor.limits.items(&limits);
    var g = try support.init(t.allocator, opts);
    defer g.deinit();
    var table = try processor.GossipProcessor.init(t.allocator, try processor.GossipProcessor.Options.resolve(limits, null, opts.topic_policy, &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }}, opts.random_seed.?));
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    try support.subscribe(&g, attestation);
    for (0..3) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
    var large: [6000]u8 = undefined;
    vote(&large, 1, 1);
    try receive(&g, 0, attestation, &large);
    const checks = table.claimChecks(1, processor.GossipProcessor.batch_max);
    try t.expect(table.classify(checks.tokens[0], true));
    table.maintain(60, table.slot);
    const copying = table.claim(60);
    try t.expectEqual(@as(usize, 1), copying.len);
    var small: [240]u8 = undefined;
    for (0..2) |i| {
        vote(&small, @intCast(i + 2), 1);
        try receive(&g, 1, attestation, &small);
    }
    const oldest_small = oldestReplaceable(&table);
    var candidate: [1000]u8 = undefined;
    vote(&candidate, 4, 1);
    try receive(&g, 2, attestation, &candidate);
    try t.expectEqual(@as(u64, 1), table.diag.capacityRefusals);
    try t.expectEqual(@as(u64, 0), table.diag.cancelled);
    try t.expectEqual(@as(usize, 3), table.diag.occupied);
    table.finish(&copying);
    vote(&candidate, 5, 1);
    try receive(&g, 2, attestation, &candidate);
    try t.expectEqual(@as(u64, 0), table.diag.cancelled);
    try t.expect(table.get(copying.tokens[0]) != null);
    try t.expect(table.get(oldest_small) != null);
    try t.expectEqual(@as(usize, 4), table.diag.occupied);
    try t.expectEqual(@as(usize, 4), g.resourceSnapshot().pending_validations);
}

const IwantFixture = struct {
    g: Gossipsub = undefined,
    table: processor.GossipProcessor = undefined,
    consumer: Consumer = undefined,
    sink: Gossipsub.MessageSink = undefined,
    now: u64 = 200,

    fn init(self: *IwantFixture, validation_capacity: usize) !void {
        var opts = options;
        opts.validation_capacity = validation_capacity;
        opts.iwant_followup_ms = 12_000;
        const policy = comptime policy: {
            var boundary = topic_fixture.bytes(.{ 1, 2, 3, 4 });
            for (&boundary.rules) |*rule| rule.ssz_max = 6000;
            break :policy [_]topic_policy.Boundary{boundary};
        };
        opts.topic_policy = &policy;
        self.g = try support.init(t.allocator, opts);
        errdefer self.g.deinit();
        const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
        self.table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .source_maximum = @splat(6000), .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
        errdefer self.table.deinit();
        self.table.maintain(0, 96);
        self.consumer = .{ .table = &self.table, .slot = 96 };
        self.sink = self.consumer.sink();
        self.g.message_sink = &self.sink;
        try support.subscribe(&self.g, attestation);
        try support.subscribe(&self.g, block);
        for (0..3) |i| {
            const session = support.addPeer(&self.g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
            std.debug.assert(session.index == i);
            try self.flush(@intCast(i));
        }
    }

    fn deinit(self: *IwantFixture) void {
        self.table.close();
        self.table.deinit();
        self.g.deinit();
    }

    fn rpc(self: *IwantFixture, source: u16, bytes: []const u8) !usize {
        const io = &self.g.sessions.rows[source].io;
        io.startRpc(bytes);
        defer _ = self.g.sessions.finishFrame(io);
        var turn = Gossipsub.beginPump(&self.g, Now.fromMilliseconds(.{ .mono_ms = self.now, .unix_s = 0 }));
        var credit = turn_mod.Credits.peer(&self.g.options);
        try t.expectEqual(.done, try session_io.processRpc(&self.g, source, &turn, &credit));
        return self.g.options.work_per_pump - turn.budget.work;
    }

    fn request(self: *IwantFixture, source: u16, id: Gossipsub.MessageId) !void {
        var body: [256]u8 = undefined;
        var writer = protobuf.Writer.init(&body);
        protobuf.beginIhaveRpc(&writer, attestation, 1, id.len);
        protobuf.writeIhaveId(&writer, &id);
        _ = try self.rpc(source, writer.written());
    }

    fn flush(self: *IwantFixture, source: u16) !void {
        const session = self.g.sessions.ref(source);
        for (0..64) |_| {
            const bytes = self.g.writeSegment(session);
            if (bytes.len == 0) return;
            self.g.advanceWrite(session, bytes.len, self.now);
        }
        return error.UnfinishedControlWrite;
    }

    fn promises(self: *IwantFixture, x: Gossipsub.MessageId) !void {
        try self.request(0, x);
        try self.request(0, @splat(0xee));
        try self.request(1, x);
        self.now = 300;
        try self.flush(0);
        try self.flush(1);
        try t.expectEqual(@as(usize, 3), self.g.recovery.len);
    }

    fn message(self: *IwantFixture, source: u16, payload: []const u8) !usize {
        var compressed: [8192]u8 = undefined;
        const len = try snappy.raw.compress(payload, &compressed);
        return self.receiveCompressed(source, compressed[0..len]);
    }

    fn receiveCompressed(self: *IwantFixture, source: u16, data: []const u8) !usize {
        var encoded: [16384]u8 = undefined;
        var writer = protobuf.Writer.init(&encoded);
        protobuf.writeMessage(&writer, data, attestation);
        return self.rpc(source, writer.written());
    }

    fn expire(self: *IwantFixture, p: f64, q: f64) !void {
        self.g.expirePromises(12_299);
        try t.expectEqual(@as(u64, 0), self.g.counters.broken_promises);
        self.g.expirePromises(12_300);
        try t.expectEqual(p, self.g.peers.scores.rows[self.g.sessions.rows[0].logical.index].behaviour);
        try t.expectEqual(q, self.g.peers.scores.rows[self.g.sessions.rows[1].logical.index].behaviour);
        try t.expectEqual(@as(usize, 0), self.g.recovery.len);
    }
};

test "gossip identified receipts settle only their IWANT ID across providers despite admission refusal" {
    const Case = enum { admitted, ineligible, source_items, processor_source, processor_bytes, validation_capacity, cached };
    for (std.enums.values(Case)) |case| {
        var f: IwantFixture = .{};
        try f.init(if (case == .source_items or case == .validation_capacity) 2 else 64);
        defer f.deinit();
        var backing: [6000]u8 = undefined;
        const payload = backing[0..if (case == .processor_bytes) 6000 else 240];
        const slot: u64 = if (case == .ineligible or case == .cached) 1000 else 96;
        vote(payload, 10, slot);
        const x = topic_mod.validMessageId(attestation, payload, .{});
        if (case == .cached) {
            _ = try f.message(0, payload);
            try t.expect(!f.g.messages.known(x, f.now));
            f.table.close();
        }
        if (case == .source_items or case == .processor_source or case == .processor_bytes or case == .validation_capacity) {
            var filler_backing: [6000]u8 = undefined;
            const filler = filler_backing[0..if (case == .processor_bytes) 6000 else 240];
            const count: usize = if (case == .source_items or case == .processor_bytes) 1 else 2;
            for (0..count) |i| {
                vote(filler, @intCast(i), 96);
                _ = try f.message(if (case == .validation_capacity) @intCast(i + 1) else 0, filler);
            }
            try t.expectEqual(count, f.table.diag.occupied);
            if (case == .validation_capacity) {
                const checks = f.table.claimChecks(200, processor.GossipProcessor.batch_max);
                for (checks.tokens[0..checks.len]) |token| try t.expect(f.table.classify(token, true));
                f.table.maintain(300, 96);
                const batch = f.table.claim(300);
                try t.expectEqual(count, batch.len);
                f.table.finish(&batch);
            }
        }
        const before = f.table.diag.occupied;
        try f.promises(x);
        _ = try f.message(0, payload);
        try t.expectEqual(@as(usize, 1), f.g.recovery.len);
        try t.expectEqual(before + @intFromBool(case == .admitted), f.table.diag.occupied);
        try t.expectEqual(case == .admitted, f.g.messages.known(x, f.now));
        try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&f.g));
        switch (case) {
            .admitted => {
                _ = try f.message(1, payload);
                try t.expectEqual(@as(usize, 1), f.g.recovery.len);
            },
            .ineligible, .cached => try t.expectEqual(@as(u64, 1), f.table.diag.slotRefusals),
            .source_items => try t.expectEqual(@as(u64, 1), f.g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.peer_validations)]),
            .processor_source, .processor_bytes => try t.expectEqual(@as(u64, 1), f.table.refusals[@intFromEnum(processor.limits.Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.Refusal.source_full)]),
            .validation_capacity => try t.expectEqual(@as(u64, 1), f.g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.validation_capacity)]),
        }
        try f.expire(1, 0);
    }
}

test "gossip unrelated old and future receipts cannot erase IWANT obligations" {
    for ([_]u64{ 0, 1000 }) |slot| {
        var f: IwantFixture = .{};
        try f.init(64);
        defer f.deinit();
        try f.promises(@splat(0xdd));
        var payload: [240]u8 = undefined;
        vote(&payload, 4, slot);
        _ = try f.message(0, &payload);
        try t.expectEqual(@as(u64, 1), f.table.diag.slotRefusals);
        try t.expectEqual(@as(usize, 3), f.g.recovery.len);
        try t.expectEqual(@as(usize, 0), f.table.diag.occupied);
        try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&f.g));
        try f.expire(2, 1);
    }
}

test "gossip unidentified local loss cancels only its connection and charges recovery work" {
    var f: IwantFixture = .{};
    try f.init(64);
    defer f.deinit();
    try f.promises(@splat(0xdd));
    f.table.close();
    var payload: [240]u8 = undefined;
    vote(&payload, 4, 96);
    const first_work = try f.message(0, &payload);
    try t.expectEqual(@as(usize, 1), f.g.recovery.len);
    const second_work = try f.message(0, &payload);
    try t.expect(first_work > second_work);
    try t.expect(second_work >= @sizeOf(recovery.Batch));
    try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&f.g));
    try f.expire(0, 1);
}

test "gossip invalid-domain and malformed receipts do not satisfy valid-domain promises" {
    var f: IwantFixture = .{};
    try f.init(64);
    defer f.deinit();
    const invalid = [_]u8{ 5, 0 };
    const invalid_id = topic_mod.invalidMessageId(attestation, &invalid, .{});
    try f.promises(invalid_id);
    _ = try f.receiveCompressed(0, &invalid);
    _ = try f.receiveCompressed(0, &.{0x80});
    try t.expectEqual(@as(usize, 3), f.g.recovery.len);
    try t.expectEqual(@as(f64, 2), support.invalidDeliveries(&f.g));
    try t.expect(f.g.messages.known(invalid_id, 200));
    try f.expire(2, 1);
}

test "gossip deferred receipt neither settles nor forgives promises before resumed processing" {
    var f: IwantFixture = .{};
    try f.init(64);
    defer f.deinit();
    var payload: [240]u8 = undefined;
    vote(&payload, 10, 1000);
    const x = topic_mod.validMessageId(attestation, &payload, .{});
    try f.promises(x);
    var compressed: [512]u8 = undefined;
    const len = try snappy.raw.compress(&payload, &compressed);
    var encoded: [1024]u8 = undefined;
    var writer = protobuf.Writer.init(&encoded);
    protobuf.writeMessage(&writer, compressed[0..len], attestation);
    const io = &f.g.sessions.rows[0].io;
    io.startRpc(writer.written());
    defer _ = f.g.sessions.finishFrame(io);
    var turn = Gossipsub.beginPump(&f.g, Now.fromMilliseconds(.{ .mono_ms = 300, .unix_s = 0 }));
    var credit = turn_mod.Credits.peer(&f.g.options);
    turn.budget.work = 0;
    try t.expectEqual(.credits, try session_io.processRpc(&f.g, 0, &turn, &credit));
    try t.expectEqual(@as(usize, 3), f.g.recovery.len);
    turn = Gossipsub.beginPump(&f.g, Now.fromMilliseconds(.{ .mono_ms = 301, .unix_s = 0 }));
    credit = turn_mod.Credits.peer(&f.g.options);
    try t.expectEqual(.done, try session_io.processRpc(&f.g, 0, &turn, &credit));
    try t.expectEqual(@as(usize, 1), f.g.recovery.len);
    try f.expire(1, 0);
}

test "gossip refused receipt before IWANT write completion cannot rearm its ID or another generation" {
    var f: IwantFixture = .{};
    try f.init(64);
    defer f.deinit();
    var payload: [240]u8 = undefined;
    vote(&payload, 10, 1000);
    const x = topic_mod.validMessageId(attestation, &payload, .{});
    try f.request(0, x);
    try f.request(0, @splat(0xee));
    try f.request(1, x);
    const p = f.g.sessions.ref(0);
    const segment = f.g.writeSegment(p);
    try t.expect(segment.len > 1);
    f.g.advanceWrite(p, 1, 250);
    f.now = 250;
    try t.expectEqual(@as(u64, 0), f.g.recovery.armed);
    _ = try f.message(0, &payload);
    try t.expectEqual(@as(usize, 1), f.g.recovery.len);
    f.now = 300;
    try f.flush(0);
    try f.flush(1);
    try t.expectEqual(@as(u64, 1), f.g.recovery.armed);
    // A completion from an old session generation must not reset the remaining deadline.
    f.g.writeCompleted(.{ .index = p.index, .generation = p.generation + 1 }, .{ .control = .{ .token = f.g.recovery.batches[0].token } }, 1000);
    try f.expire(1, 0);
}

test "gossip ineligible QUIC publication preserves sent IWANT promises for other IDs" {
    var pair: test_pair.Pair = .{};
    var opts = options;
    opts.iwant_followup_ms = 12_000;
    try pair.initOpts(opts, opts);
    defer pair.deinit();
    const g = pair.shared.server.gossipsub;
    try support.subscribe(g, attestation);
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
    var table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table, .slot = 96 };
    const sink = consumer.sink();
    g.message_sink = &sink;
    defer g.message_sink = null;
    for (0..16) |_| try pair.pumpOnce();
    const source = g.sessions.find(pair.shared.handles.server).?;
    var ihave: [256]u8 = undefined;
    var writer = protobuf.Writer.init(&ihave);
    const ids = [_]Gossipsub.MessageId{ @splat(0xdd), @splat(0xee) };
    var framed: [1032]u8 = undefined;
    for (ids, 0..) |id, i| {
        writer = protobuf.Writer.init(&ihave);
        protobuf.beginIhaveRpc(&writer, attestation, 1, id.len);
        protobuf.writeIhaveId(&writer, &id);
        const wire = frame.writeFrame(&framed, writer.written());
        try t.expectEqual(wire.len, try pair.shared.pair.client.write(pair.clientStream(), wire, false));
        for (0..32) |_| {
            try pair.pumpOnce();
            if (g.recovery.armed == i + 1) break;
        }
        try t.expectEqual(@as(u64, @intCast(i + 1)), g.recovery.armed);
    }
    var payload: [240]u8 = undefined;
    vote(&payload, 10, 0);
    var compressed: [512]u8 = undefined;
    const len = try snappy.raw.compress(&payload, &compressed);
    var body: [1024]u8 = undefined;
    writer = protobuf.Writer.init(&body);
    protobuf.writeMessage(&writer, compressed[0..len], attestation);
    const wire = frame.writeFrame(&framed, writer.written());
    try t.expectEqual(wire.len, try pair.shared.pair.client.write(pair.clientStream(), wire, false));
    for (0..32) |_| {
        try pair.pumpOnce();
        if (table.diag.slotRefusals > 0) break;
    }
    try t.expectEqual(@as(u64, 1), table.diag.slotRefusals);
    try t.expectEqual(@as(usize, 2), g.recovery.len);
    try t.expectEqual(@as(f64, 0), support.invalidDeliveries(g));
    const last_expiry = @max(g.recovery.batches[0].expiry, g.recovery.batches[1].expiry);
    g.expirePromises(last_expiry);
    try t.expectEqual(@as(u64, 2), g.counters.broken_promises);
    try t.expectEqual(@as(f64, 2), g.peers.scores.rows[g.sessions.rows[source].logical.index].behaviour);
}

// A test oracle independent of the production expiry-chain traversal.
fn oldestReplaceable(table: *const processor.GossipProcessor) processor.GossipProcessor.Token {
    var oldest: ?processor.GossipProcessor.Token = null;
    for (table.cells, 0..) |cell, i| {
        if (cell.kind != .beacon_attestation or !cell.replaceable()) continue;
        if (oldest == null or cell.order < table.cells[oldest.?.index].order) oldest = .{ .index = @intCast(i), .generation = cell.generation };
    }
    return oldest.?;
}

test "gossip replacement keeps original arrival age across dependency promotion" {
    var f: IwantFixture = .{};
    try f.init(64);
    defer f.deinit();
    var data: [240]u8 = undefined;
    vote(&data, 1, 96);
    _ = try f.message(0, &data);
    const first = oldestReplaceable(&f.table);
    const first_handle = f.table.get(first).?.handle;
    const deadline = f.table.get(first).?.deadline;
    const root = f.table.get(first).?.metadata.root.?;
    const checks = f.table.claimChecks(f.now, processor.GossipProcessor.batch_max);
    try t.expectEqual(@as(usize, 1), checks.len);
    try t.expect(f.table.classify(first, false));
    // Later arrivals include an older (still useful) slot. Eviction age is
    // network arrival, not unauthenticated slot rank.
    for (0..3) |i| {
        vote(&data, @intCast(i + 2), if (i == 0) 95 else 96);
        _ = try f.message(if (i == 0) 0 else 1, &data);
    }
    const later = f.table.claimChecks(f.now, processor.GossipProcessor.batch_max);
    try t.expectEqual(@as(usize, 3), later.len);
    for (later.tokens[0..later.len]) |token| try t.expect(f.table.classify(token, true));
    f.table.notifyBlock(root);
    f.table.maintain(f.now, 96);
    const promoted = f.table.claimChecks(f.now, processor.GossipProcessor.batch_max);
    try t.expectEqual(@as(usize, 1), promoted.len);
    try t.expectEqual(first, promoted.tokens[0]);
    try t.expect(f.table.classify(first, true));
    try t.expectEqual(deadline, f.table.get(first).?.deadline);
    const queued = f.table.queues[@intFromEnum(processor.limits.Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.State.queued)];
    try t.expectEqual(first.index, queued.tail);
    try t.expect(queued.head != first.index);
    vote(&data, 9, 95);
    _ = try f.message(2, &data);
    try t.expect(f.table.get(first) == null);
    for (later.tokens[0..later.len]) |token| try t.expect(f.table.get(token) != null);
    try t.expectEqual(@as(usize, 4), f.table.diag.occupied);
    try t.expectEqual(@as(u64, 1), f.table.diag.cancelled);
    try t.expectEqual(Gossipsub.ReportOutcome.stale_handle, f.g.report(first_handle, .reject, Now.fromMilliseconds(.{ .mono_ms = f.now, .unix_s = 0 })));
    try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&f.g));
}

test "gossip eviction scan is work charged and leaves candidates untouched on exhaustion" {
    for ([_]bool{ false, true }) |after_selection| {
        var f: IwantFixture = .{};
        try f.init(64);
        defer f.deinit();
        try receive(&f.g, 0, block, "older FIFO work");
        var data: [4097]u8 = undefined;
        for (0..4) |i| {
            vote(data[0..513], @intCast(i), 96);
            _ = try f.message(@intCast(i / 2), data[0..513]);
        }
        const victim = oldestReplaceable(&f.table);
        const original_id = f.table.get(victim).?.id;
        const handle = f.table.get(victim).?.handle;
        const payload = f.g.messages.validation.entries[handle.index].state.pending.message;
        const victim_cost = f.table.get(victim).?.input.len + f.g.messages.store.get(payload).?.len;
        const pages = f.table.store.free_pages;
        const protocol_pages = f.g.messages.store.free_pages;
        vote(&data, 9, 96);
        const id = topic_mod.validMessageId(attestation, &data, .{});
        var compressed: [8192]u8 = undefined;
        const length = try snappy.raw.compress(&data, &compressed);
        var turn = Gossipsub.beginPump(&f.g, Now.fromMilliseconds(.{ .mono_ms = f.now, .unix_s = 0 }));
        var credit = turn_mod.Credits.peer(&f.g.options);
        // The newcomer needs two victims. Exhaust work either before choosing
        // the first or after choosing one, leaving both stores untouched.
        const cost = length * 2 + data.len * 2;
        const charged = cost + @sizeOf(processor.GossipProcessor.Cell) + if (after_selection) @sizeOf(processor.GossipProcessor.Cell) + victim_cost else @as(usize, 0);
        turn.budget.work = charged + @sizeOf(processor.GossipProcessor.Cell) - 1;
        credit.work = turn.budget.work;
        const before = turn.budget.work;
        try t.expectEqual(.done, f.g.receiveItem(f.g.sessions.ref(2), .{ .message = .{ .topic = attestation, .data = compressed[0..length] } }, &turn, &credit));
        // Identified refusal also settles its IWANT ID. With no outstanding
        // requests that costs only hashing the ID and reading its empty bucket.
        try t.expectEqual(@as(usize, 0), f.g.recovery.len);
        try t.expectEqual(charged + @sizeOf(Gossipsub.MessageId) + @sizeOf(u16), before - turn.budget.work);
        try t.expectEqual(original_id, f.table.get(victim).?.id);
        try t.expectEqual(pages, f.table.store.free_pages);
        try t.expectEqual(protocol_pages, f.g.messages.store.free_pages);
        try t.expectEqual(.pending, f.g.messages.validation.find(original_id, f.now).?.state);
        try t.expectEqual(handle, f.table.get(victim).?.handle);
        try t.expectEqual(@as(usize, 5), f.table.diag.occupied);
        try t.expectEqual(@as(u64, 0), f.table.diag.cancelled);
        try t.expect(!f.g.messages.known(id, f.now));
        try t.expect(!f.g.messages.known(id, f.now));
        _ = try f.message(2, &data);
        try t.expect(f.table.get(victim) == null);
        try t.expect(f.g.messages.known(id, f.now));
    }
}

test "gossip local replacement permits recovery and readmission without accepting stale verdicts" {
    var f: IwantFixture = .{};
    try f.init(64);
    defer f.deinit();
    var data: [240]u8 = undefined;
    vote(&data, 1, 96);
    const id = topic_mod.validMessageId(attestation, &data, .{});
    _ = try f.message(0, &data);
    const victim = oldestReplaceable(&f.table);
    const handle = f.table.get(victim).?.handle;
    _ = try f.message(1, &data);
    for (0..3) |i| {
        vote(&data, @intCast(i + 2), 96);
        _ = try f.message(if (i == 0) 0 else 1, &data);
    }
    vote(&data, 9, 96);
    _ = try f.message(2, &data);
    try t.expect(f.table.get(victim) == null);
    try t.expect(!f.g.messages.known(id, f.now));
    try t.expectEqual(null, f.g.messages.validation.find(id, f.now));
    try t.expect(!f.g.messages.known(id, f.now));
    try f.request(2, id);
    try f.flush(2);
    try t.expectEqual(@as(usize, 1), f.g.recovery.len);
    vote(&data, 1, 96);
    _ = try f.message(2, &data);
    try t.expectEqual(@as(usize, 4), f.table.diag.occupied);
    try t.expectEqual(@as(usize, 0), f.g.recovery.len);
    const current = f.g.messages.validation.find(id, f.now).?.handle;
    try t.expect(!std.meta.eql(handle, current));
    try t.expectEqual(Gossipsub.ReportOutcome.stale_handle, f.g.report(handle, .reject, Now.fromMilliseconds(.{ .mono_ms = f.now, .unix_s = 0 })));
    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, f.g.report(current, .accept, Now.fromMilliseconds(.{ .mono_ms = f.now, .unix_s = 0 })));
    try t.expectEqual(@as(f64, 0), support.invalidDeliveries(&f.g));
}

test "gossip replacement preflights compressed and decoded pages across multiple victims" {
    var opts = options;
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 8192 });
    var boundary = topic_fixture.bytes(.{ 1, 2, 3, 4 });
    for (&boundary.rules) |*rule| rule.ssz_max = 6000;
    opts.topic_policy = &.{boundary};
    opts.payload_limits = limits;
    opts.validation_capacity = processor.limits.items(&limits);
    var g = try support.init(t.allocator, opts);
    defer g.deinit();
    var table = try processor.GossipProcessor.init(t.allocator, try processor.GossipProcessor.Options.resolve(limits, null, opts.topic_policy, &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }}, opts.random_seed.?));
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    try support.subscribe(&g, attestation);
    for (0..3) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
    var random = std.Random.DefaultPrng.init(1971);
    var data: [4097]u8 = undefined;
    var tokens: [4]processor.GossipProcessor.Token = undefined;
    var ids: [4]Gossipsub.MessageId = undefined;
    for (0..4) |i| {
        const bytes = data[0..if (i < 2) 513 else 240];
        random.random().bytes(bytes);
        std.mem.writeInt(u64, bytes[16..24], 1, .little);
        ids[i] = topic_mod.validMessageId(attestation, bytes, .{});
        try receive(&g, @intCast(i / 2), attestation, bytes);
        const index = table.expiry.tail;
        tokens[i] = .{ .index = @intCast(index), .generation = table.cells[index].generation };
    }
    const k = @intFromEnum(processor.limits.Kind.beacon_attestation);
    try t.expectEqual(@as(usize, 8192), table.used_bytes[k]);
    try t.expectEqual(@as(usize, 2), g.messages.store.pending_by_kind[k]);
    random.random().bytes(&data);
    std.mem.writeInt(u64, data[16..24], 1, .little);
    try receive(&g, 2, attestation, &data);
    try t.expectEqual(@as(u64, 2), table.diag.cancelled);
    try t.expectEqual(@as(usize, 3), table.diag.occupied);
    try t.expectEqual(@as(usize, 3), g.resourceSnapshot().pending_validations);
    try t.expectEqual(@as(usize, 8192), table.used_bytes[k]);
    try t.expectEqual(@as(usize, 2), g.messages.store.pending_by_kind[k]);
    for (tokens, ids, 0..) |token, id, i| {
        try t.expectEqual(i >= 2, table.get(token) != null);
        try t.expectEqual(i >= 2, g.messages.known(id, 1));
    }
}

test "gossip processor pending validation quota preserves room for another peer and refunds completed work" {
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 1024 };
    for ([_]bool{ false, true }) |planned| {
        var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary}, .validation_capacity = if (planned) 4 * processor.limits.kind_count else 4, .payload_limits = if (planned) @as(processor.limits.Limits, @splat(.{ .items = 4, .bytes = 4096 })) else null });
        defer g.deinit();
        const first = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
        const second = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
        try support.subscribe(&g, "/eth2/01020304/beacon_block/ssz_snappy");
        const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
        var table = try processor.GossipProcessor.init(t.allocator, try processor.GossipProcessor.Options.resolve(limits, null, g.options.topic_policy, &.{.{ .digest = boundary.digest, .fork = .fulu }}, 1));
        defer table.deinit();
        defer table.close();
        var consumer: Consumer = .{ .table = &table };
        const sink = consumer.sink();
        g.message_sink = &sink;
        try std.testing.expectEqual(@as(?usize, 1), try support.message(&g, first.index, "first", 1));
        const batch = table.claim(1);
        try t.expectEqual(@as(usize, 1), batch.len);
        const token = batch.tokens[0];
        const held = table.get(token).?.handle;
        table.finish(&batch);
        try std.testing.expectEqual(@as(?usize, 1), try support.message(&g, first.index, "second", 2));
        try std.testing.expectEqual(@as(?usize, 0), try support.message(&g, first.index, "third", 3));
        try std.testing.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.peer_validations)]);
        try std.testing.expectEqual(@as(f64, 0), g.peers.score(g.sessions.rows[first.index].logical, 3));
        try std.testing.expectEqual(@as(?usize, 1), try support.message(&g, second.index, "other peer", 4));
        try t.expect(table.report(token, .ignore, 5));
        try std.testing.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, g.report(held, .ignore, Now.fromMilliseconds(.{ .mono_ms = 5, .unix_s = 0 })));
        table.retire(token);

        try std.testing.expectEqual(@as(?usize, 1), try support.message(&g, first.index, "third", 6));
    }
}

test "gossip protocol expiry frees compressed storage while host work retains processor charges" {
    const limits: processor.limits.Limits = @splat(.{ .items = 4, .bytes = 8192 });
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 6000 };
    var opts = options;
    opts.topic_policy = &.{boundary};
    opts.payload_limits = limits;
    opts.validation_capacity = processor.limits.items(&limits);
    opts.validation_timeout_ms = 100;
    var g = try support.init(t.allocator, opts);
    defer g.deinit();
    var table = try processor.GossipProcessor.init(t.allocator, try processor.GossipProcessor.Options.resolve(limits, null, opts.topic_policy, &.{.{ .digest = boundary.digest, .fork = .fulu }}, 1));
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table };
    const sink = consumer.sink();
    g.message_sink = &sink;
    try support.subscribe(&g, block);
    for (0..2) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;

    const kind = @intFromEnum(processor.limits.Kind.beacon_block);
    var random = std.Random.DefaultPrng.init(913);
    var payload: [4097]u8 = undefined;
    random.random().bytes(&payload);
    std.mem.writeInt(u64, payload[100..108], 1, .little);
    try receive(&g, 0, block, &payload);
    const batch = table.claim(1);
    try t.expectEqual(@as(usize, 1), batch.len);
    const token = batch.tokens[0];
    const validation = table.get(token).?.handle;
    table.finish(&batch);
    try t.expectEqual(@as(usize, 0), table.used_bytes[kind]);
    try t.expectEqual(@as(usize, 2), g.messages.store.pending_by_kind[kind]);

    random.random().bytes(&payload);
    std.mem.writeInt(u64, payload[100..108], 1, .little);
    var compressed: [8192]u8 = undefined;
    const len = try snappy.raw.compress(&payload, &compressed);
    const message: protobuf.Message = .{ .topic = block, .data = compressed[0..len] };
    try t.expect(table.hasCapacity(.beacon_block, payload.len));
    try t.expectEqual(@as(?usize, 0), support.receiveMessage(&g, 1, message, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
    try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.kind_payload)]);
    try t.expectEqual(@as(u64, 0), table.diag.capacityRefusals);
    try t.expectEqual(@as(u64, 0), table.refusals[kind][@intFromEnum(processor.GossipProcessor.Refusal.store_full)]);

    g.messages.expire(&g.peers, 101);
    table.expire(101);
    try t.expectEqual(@as(usize, 0), g.resourceSnapshot().pending_validations);
    try t.expectEqual(@as(usize, 0), g.messages.store.pending_by_kind[kind]);
    try t.expectEqual(@as(usize, 1), table.used_items[kind]);
    try t.expectEqual(@as(usize, payload.len), table.executing_bytes[kind]);
    try t.expectEqual(@as(?usize, 0), support.receiveMessage(&g, 0, message, Now.fromMilliseconds(.{ .mono_ms = 102, .unix_s = 0 })));
    try t.expectEqual(@as(u64, 1), table.refusals[kind][@intFromEnum(processor.GossipProcessor.Refusal.source_full)]);
    try t.expectEqual(@as(?usize, 1), support.receiveMessage(&g, 1, message, Now.fromMilliseconds(.{ .mono_ms = 103, .unix_s = 0 })));
    try t.expectEqual(@as(usize, 0), table.claim(103).len);
    try t.expect(!table.report(token, .accept, 104));
    try t.expectEqual(Gossipsub.ReportOutcome.expired, g.report(validation, .accept, Now.fromMilliseconds(.{ .mono_ms = 104, .unix_s = 0 })));

    const next = table.claim(104);
    try t.expectEqual(@as(usize, 1), next.len);
    table.finish(&next);
}

test "gossip processor ignores unsearchable unknown roots after checking while retaining known old roots" {
    var g = try support.init(t.allocator, options);
    defer g.deinit();
    const limits: processor.limits.Limits = @splat(.{ .items = 8, .bytes = 16384 });
    var table = try processor.GossipProcessor.init(t.allocator, .{ .limits = limits, .forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }} });
    defer table.deinit();
    defer table.close();
    var consumer: Consumer = .{ .table = &table, .slot = 32 };
    const sink = consumer.sink();
    g.message_sink = &sink;
    _ = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try support.subscribe(&g, attestation);
    table.maintain(1, consumer.slot);
    const k = @intFromEnum(processor.limits.Kind.beacon_attestation);
    const refusal = @intFromEnum(processor.GossipProcessor.Refusal.dependency_unsearchable);
    const cases = [_]struct { slot: u64, available: bool, state: processor.GossipProcessor.State }{
        .{ .slot = 29, .available = false, .state = .completion_pending },
        .{ .slot = 30, .available = false, .state = .waiting },
        .{ .slot = 29, .available = true, .state = .queued },
        .{ .slot = 33, .available = false, .state = .waiting },
    };
    for (cases, 0..) |case, i| {
        var bytes: [240]u8 = undefined;
        vote(&bytes, @intCast(i + 1), case.slot);
        try receive(&g, 0, attestation, &bytes);
        const checks = table.claimChecks(1, processor.GossipProcessor.batch_max);
        try t.expectEqual(@as(usize, 1), checks.len);
        try t.expectEqual(@as(u64, @intFromBool(i > 0)), table.refusals[k][refusal]);
        const token = checks.tokens[0];
        const cell = table.get(token).?;
        try t.expect(table.classify(token, case.available));
        try t.expectEqual(case.state, cell.state);
        try t.expectEqual(@as(u64, 1), table.refusals[k][refusal]);
        if (case.state == .completion_pending) {
            try t.expectEqual(processor.GossipProcessor.Completion.cancelled, cell.completion);
            const now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
            try t.expect(g.cancel(cell.handle, now));
            table.retire(token);
        }
    }
    try t.expectEqual(@as(usize, 2), table.waiting_items[k]);
    try t.expectEqual(@as(u64, 0), table.refusals[k][@intFromEnum(processor.GossipProcessor.Refusal.dependency_full)]);
}
