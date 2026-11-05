const std = @import("std");
const Now = @import("../types.zig").Now;
const t = std.testing;
const messages = @import("messages.zig");
const Gossipsub = @import("Gossipsub.zig");
const support = @import("test_support.zig");
const topic = @import("topic.zig");
const constants = @import("constants.zig");
const topic_policy = @import("topic_policy.zig");
const snappy = @import("snappy");
const turn_mod = @import("turn.zig");
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";

test "message knowledge separates unfinished work from verdicts for receipt and publication" {
    const End = enum { cancel, expire, accept, reject, ignore };
    for (std.enums.values(End)) |end| {
        var g = try support.init(t.allocator, .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1, .validation_capacity = 1, .validation_timeout_ms = 10, .validation_tombstone_ms = 5, .seen_capacity = 2, .seen_ttl_ms = 20 });
        defer g.deinit();
        var inbox: support.Inbox = .{};
        defer inbox.deinit();
        inbox.attach(&g);
        try support.subscribe(&g, test_topic);
        const first = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
        const second = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
        try t.expectEqual(@as(?usize, 1), try support.message(&g, first.index, "A", 1));
        const message = inbox.last();
        try t.expect(g.messages.known(message.id, 2));
        try t.expect(!g.messages.seen.contains(message.id, 2));
        try t.expectEqual(@as(?usize, 0), try support.message(&g, second.index, "A", 2));
        try t.expectError(error.Duplicate, g.publish(test_topic, "A", Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
        for ([_]u16{ first.index, second.index }) |index| try t.expectEqual(@as(u32, 1), g.peers.rows[g.logical(index).index].pins);
        const decided = end != .cancel and end != .expire;
        switch (end) {
            .cancel => try t.expect(g.cancel(message.handle, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }))),
            .expire => g.messages.expire(&g.peers, 11),
            .accept, .reject, .ignore => {
                const verdict: Gossipsub.Verdict = switch (end) {
                    .accept => .accept,
                    .reject => .reject,
                    .ignore => .ignore,
                    else => unreachable,
                };
                try t.expectEqual(Gossipsub.ReportOutcome{ .applied = verdict }, g.report(message.handle, verdict, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 })));
            },
        }
        for ([_]u16{ first.index, second.index }) |index| try t.expectEqual(@as(u32, 0), g.peers.rows[g.logical(index).index].pins);
        try t.expectEqual(@as(usize, 0), g.messages.pendingValidations());
        try t.expectEqual(decided, g.messages.known(message.id, 12));
        try t.expectEqual(decided, g.messages.seen.contains(message.id, 12));
        if (!decided) {
            const stale: Gossipsub.ReportOutcome = if (end == .expire) .expired else .stale_handle;
            try t.expectEqual(stale, g.report(message.handle, .reject, Now.fromMilliseconds(.{ .mono_ms = 12, .unix_s = 0 })));
        }
        try t.expectEqual(@as(?usize, if (decided) 0 else 1), try support.message(&g, second.index, "A", 12));
        try t.expect(!g.cancel(message.handle, Now.fromMilliseconds(.{ .mono_ms = 12, .unix_s = 0 })));
        try t.expect(g.messages.known(message.id, 12));
        if (!decided) {
            const current = inbox.last().handle;
            try t.expectEqual(message.handle.index, current.index);
            try t.expectEqual(message.handle.generation + 1, current.generation);
            try t.expectEqual(Gossipsub.ReportOutcome.stale_handle, g.report(message.handle, .reject, Now.fromMilliseconds(.{ .mono_ms = 12, .unix_s = 0 })));
            try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(current, .accept, Now.fromMilliseconds(.{ .mono_ms = 12, .unix_s = 0 })));
        }
    }
}

test "message knowledge retains decisions across seen eviction and orders TTL by resolution" {
    var g = try support.init(t.allocator, .{ .random_seed = 1, .connected_capacity = 1, .retained_capacity = 5, .retained_outbound_reserve = 1, .validation_capacity = 4, .validation_timeout_ms = 100, .validation_tombstone_ms = 5, .seen_capacity = 2, .seen_ttl_ms = 20 });
    defer g.deinit();
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try support.subscribe(&g, test_topic);
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    _ = try support.message(&g, peer.index, "A", 1);
    const first = inbox.last();
    _ = try support.message(&g, peer.index, "B", 2);
    const second = inbox.last();
    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, g.report(second.handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 4, .unix_s = 0 })));
    try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, g.report(first.handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 5, .unix_s = 0 })));
    try t.expectEqual(@as(u64, 4), g.messages.seen.added_ms[g.messages.seen.tail]);
    _ = try g.publish(test_topic, "C", Now.fromMilliseconds(.{ .mono_ms = 6, .unix_s = 0 }));
    try t.expect(!g.messages.seen.contains(second.id, 8));
    try t.expect(g.messages.known(second.id, 8));
    try t.expectError(error.Duplicate, g.publish(test_topic, "B", Now.fromMilliseconds(.{ .mono_ms = 8, .unix_s = 0 })));
    try t.expect(!g.messages.known(second.id, 9));
    try t.expect(g.messages.known(first.id, 24));
    try t.expect(!g.messages.known(first.id, 25));
}

test "message admission retains canonical topic bounds" {
    const Sink = struct {
        canonical: ?topic.Canonical = null,
        maximum: usize = 0,
        handle: Gossipsub.ValidationHandle = undefined,
        id: Gossipsub.MessageId = undefined,

        fn hasCapacity(_: *anyopaque, _: topic.Kind, _: usize) bool {
            return true;
        }

        fn admit(context: *anyopaque, candidate: *Gossipsub.MessageAdmission) bool {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.canonical = candidate.canonical;
            self.maximum = candidate.maximum_compressed;
            if (!candidate.sourceRoom() or !candidate.fits(&candidate.room())) return false;
            candidate.commit();
            self.handle = candidate.event.handle;
            self.id = candidate.event.id;
            return true;
        }
    };
    {
        const name = "/eth2/01020304/beacon_block/ssz_snappy";
        var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
        boundary.rules[0] = .{ .count = 1, .ssz_min = 4, .ssz_max = 6000 };
        var options: Gossipsub.Options = .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1, .seen_capacity = 16, .mcache_capacity = 16, .validation_capacity = 8 };
        options.topic_policy = &.{boundary};
        var g = try Gossipsub.init(t.allocator, options);
        defer g.deinit();
        const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
        const index = support.activate(&g, name).?;
        g.overlay.rows[index].subscribed = true;
        const context = g.messageContext();
        const source: messages.Source = .{ .peer = g.sessions.rows[peer.index].logical, .session = peer, .connection = g.sessions.rows[peer.index].conn };
        var sink: Sink = .{};
        const callback: messages.MessageSink = .{ .context = &sink, .has_capacity = Sink.hasCapacity, .admit = Sink.admit };
        var turn = Gossipsub.beginPump(&g, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
        turn.sink = &callback;
        var credits = turn_mod.Credits.peer(&g.options);
        const workspace = turn.workspace(&credits);
        var compressed: [64]u8 = undefined;
        const len = try snappy.raw.compress("data", &compressed);
        const received = g.messages.receive(&context, &workspace, &source, .{ .topic = name, .data = compressed[0..len] }, 1);
        try t.expect(received == .admitted);
        try t.expectEqual(index, received.admitted.topic_index);
        try t.expectEqual(sink.id, received.admitted.id);
        try t.expectEqual(true, sink.canonical != null);
        if (sink.canonical) |canonical| try t.expectEqual(topic.Kind.beacon_block, canonical.name.kind);
        const maximum = constants.maxCompressedLen(6000);
        try t.expectEqual(maximum, sink.maximum);
        try t.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, g.report(sink.handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
    }
}

test "gossip retention pressure preserves delayed verdicts and permits refused message retries" {
    for ([_]Gossipsub.Verdict{ .accept, .reject }) |verdict| {
        var g = try support.init(t.allocator, .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 });
        defer g.deinit();
        var inbox: support.Inbox = .{};
        defer inbox.deinit();
        inbox.attach(&g);
        try support.subscribe(&g, test_topic);
        const first_conn: @import("../quic/Engine.zig").Handle = .{ .index = 0, .generation = 1 };
        const second_conn: @import("../quic/Engine.zig").Handle = .{ .index = 1, .generation = 1 };
        const first = support.addPeer(&g, first_conn, .v1_2).?;
        const second = support.addPeer(&g, second_conn, .v1_2).?;
        const original = g.logical(first.index);
        const duplicate = g.logical(second.index);
        try t.expectEqual(@as(?usize, 1), try support.message(&g, first.index, "A", 1));
        const message = inbox.last();
        try t.expectEqual(@as(?usize, 0), try support.message(&g, second.index, "A", 2));
        try t.expectEqual(@as(u16, 2), g.peers.pinned);
        g.connectionClosed(first_conn);
        g.connectionClosed(second_conn);
        const fresh = support.addPeer(&g, .{ .index = 0, .generation = 2 }, .v1_2).?;
        const logical = g.logical(fresh.index);
        const index = g.overlay.findTopic(test_topic).?;
        g.overlay.rows[index].mesh.set(fresh.index);
        g.peers.scores.graft(logical.index, index, 0);
        try t.expectEqual(@as(?usize, 0), try support.message(&g, fresh.index, "A", 3));
        try t.expectEqual(@as(u8, 1), g.messages.validation.find(message.id, 3).?.duplicate_len);
        try t.expectEqual(@as(?usize, 0), try support.message(&g, fresh.index, "B", 4));
        try t.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(messages.StorageRefusal.peer_retention)]);
        const counters = &g.peers.scores.topics[@as(usize, logical.index) * g.peers.scores.topic_params.len + index];
        try t.expectEqual(@as(f64, 0), counters.mesh_deliveries);
        try t.expectEqual(@as(u64, 4), counters.delivery_restart_ms);
        var wanted = [_]Gossipsub.MessageId{@splat(9)};
        try t.expectError(error.PeerCapacity, g.recovery.filterPending(&g.peers, logical, &wanted));
        try t.expectEqual(@as(u32, 0), g.peers.rows[logical.index].pins);
        try t.expectEqual(Gossipsub.ReportOutcome{ .applied = verdict }, g.report(message.handle, verdict, Now.fromMilliseconds(.{ .mono_ms = 5, .unix_s = 0 })));
        try t.expectEqual(@as(u16, 0), g.peers.pinned);
        for ([_]@import("peer_book.zig").Ref{ original, duplicate }) |ref| {
            try t.expect(g.peers.matches(ref));
            const held = g.peers.scores.topics[@as(usize, ref.index) * g.peers.scores.topic_params.len + index];
            try t.expectEqual(@as(f64, if (verdict == .reject) 1 else 0), held.invalid);
        }
        try t.expectEqual(@as(f64, 0), counters.invalid);
        try t.expectEqual(@as(?usize, 1), try support.message(&g, fresh.index, "B", 6));
        try t.expectEqual(@as(u16, 1), g.peers.pinned);
    }
}
