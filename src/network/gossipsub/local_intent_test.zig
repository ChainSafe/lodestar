const std = @import("std");
const Now = @import("../types.zig").Now;
const local = @import("local_intent.zig");
const Gossipsub = @import("Gossipsub.zig");
const topic = @import("topic.zig");
const support = @import("test_support.zig");
const full = @import("topic_fixture.zig").full;
const name = "/eth2/01020304/beacon_block/ssz_snappy";
const next = "/eth2/01020304/voluntary_exit/ssz_snappy";
const boundaries = [_]topic_policy.Boundary{ full(.{ 1, 2, 3, 4 }), full(.{ 5, 6, 7, 8 }), full(.{ 9, 10, 11, 12 }) };
const topic_policy = @import("topic_policy.zig");
const topic_fixture = @import("topic_fixture.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const snappy = @import("snappy");
const constants = @import("constants.zig");
const message_store = @import("message_store.zig");
const now: Now = Now.fromMilliseconds(.{ .mono_ms = 100, .unix_s = 0 });

fn options() Gossipsub.Options {
    return .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1, .seen_capacity = 16, .mcache_capacity = 16, .validation_capacity = 8, .topic_policy = &boundaries };
}

fn apply(g: *Gossipsub, w: *local.Workspace, desired: []const []const u8) !bool {
    var buffer: [64]local.Boundary = undefined;
    const changed = try g.prepareSubscriptions(try topic_fixture.subscriptionsInto(desired, &buffer), w, now, 0);
    if (changed) g.commitSubscriptions(w);
    return changed;
}

test "local intent exact capacity excess and namespace refusal" {
    var backing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var ledger: CountingAllocator = .{ .backing = backing.allocator() };
    var g = try Gossipsub.init(ledger.allocator(), options());
    defer g.deinit();
    const w = try std.testing.allocator.create(local.Workspace);
    defer std.testing.allocator.destroy(w);
    w.* = .{};
    var names: [513][topic.topic_max_len]u8 = undefined;
    var desired: [513][]const u8 = undefined;
    for (&desired, 0..) |*entry, i| {
        const digest: u32 = if (i < 256) 0x01020304 else if (i < 512) 0x05060708 else 0x090a0b0c;
        const kind: []const u8 = if (i % 256 < 128) "blob_sidecar" else "data_column_sidecar";
        entry.* = try std.fmt.bufPrint(&names[i], "/eth2/{x:0>8}/{s}_{d}/ssz_snappy", .{ digest, kind, i % 128 });
    }
    const calls = backing.allocations;
    try std.testing.expectError(error.TopicCapacity, apply(&g, w, &desired));
    try std.testing.expect(g.overlay.findTopic(desired[0]) == null);
    try std.testing.expect(try apply(&g, w, desired[0..512]));
    try std.testing.expect(!try apply(&g, w, desired[0..512]));
    try std.testing.expectError(error.InvalidTopic, apply(&g, w, &.{ desired[0], "invalid" }));
    try std.testing.expectError(error.TopicCapacity, apply(&g, w, &desired));
    for (desired[0..512]) |topic_name| try std.testing.expect(g.overlay.subscribed(g.overlay.namespace.lookup(topic_name).?.ordinal));
    try std.testing.expect(try apply(&g, w, &.{}));
    const first = g.overlay.namespace.lookup(desired[0]).?.ordinal;
    const deadline = g.overlay.rows[first].retire_after_ms;
    try std.testing.expect(!try g.prepareSubscriptions(&.{}, w, Now.fromMilliseconds(.{ .mono_ms = 200, .unix_s = 0 }), 0));
    try std.testing.expectEqual(deadline, g.overlay.rows[first].retire_after_ms);
    try std.testing.expectEqual(calls, backing.allocations);
}

test "local intent history survives topic expiry and real retransmission descriptor" {
    var g = try Gossipsub.init(std.testing.allocator, options());
    defer g.deinit();
    const w = try std.testing.allocator.create(local.Workspace);
    defer std.testing.allocator.destroy(w);
    w.* = .{};
    _ = try g.publish(name, "history payload", now);
    const id = topic.validMessageId(name, "history payload", .{});
    const retained = g.messages.history.message(g.messages.history.get(&g.messages.store, id).?);
    try std.testing.expect(try apply(&g, w, &.{next}));
    g.overlay.expireTopic(&g.overlayContext(g.last_now_ms), 0, false);
    try std.testing.expect(!g.overlay.rows[0].active);
    try std.testing.expect(g.overlay.findTopic(next) != null);
    const entry = g.messages.store.get(retained).?;
    try std.testing.expectEqualStrings(name, entry.topicString());
    var payload: [64]u8 = undefined;
    const read = try snappy.raw.uncompress(g.messages.store.segment(retained, g.messages.store.cursor(retained)), &payload);
    try std.testing.expectEqualStrings("history payload", payload[0..read]);
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const io = &g.sessions.rows[peer.index].io;
    const served = g.messages.serve(&io.tx, g.sessions.rows[peer.index].logical, id, .{ .bytes = constants.tx_peer_bytes }, now.millis());
    try std.testing.expect(served == .known);
    try std.testing.expectEqual(.queued, served.known);
    try std.testing.expectEqual(retained, (io.tx.data.next(&g.messages.store, g.last_now_ms, g.options.tx_timeout_ms)).?.message);
    try std.testing.expectEqualStrings(name, g.messages.store.get((io.tx.data.next(&g.messages.store, g.last_now_ms, g.options.tx_timeout_ms)).?.message).?.topicString());
    try std.testing.expect((io.tx.segment(&g.messages.store, 0)).len > 0);
}

test "compact intent validates masks and boundary identities before mutation" {
    var allowed = boundaries;
    allowed[0].rules[@intFromEnum(topic.Kind.data_column_sidecar)] = .{};
    var opts = options();
    opts.topic_policy = &allowed;
    var g = try Gossipsub.init(std.testing.allocator, opts);
    defer g.deinit();
    const w = try std.testing.allocator.create(local.Workspace);
    defer std.testing.allocator.destroy(w);
    w.* = .{};
    const sets = topic_fixture.subscriptions(&.{name});
    try std.testing.expectError(error.DuplicateBoundary, g.prepareSubscriptions(&.{ sets[0], sets[0] }, w, now, 0));
    var invalid = sets[0];
    invalid.digest = @splat(255);
    try std.testing.expectError(error.InvalidTopic, g.prepareSubscriptions(&.{invalid}, w, now, 0));
    invalid = sets[0];
    invalid.mask(.sync_committee)[0] = 16;
    invalid.lengths[@intFromEnum(topic.Kind.sync_committee)] = 1;
    try std.testing.expectError(error.InvalidTopic, g.prepareSubscriptions(&.{invalid}, w, now, 0));
    invalid = sets[0];
    invalid.lengths[@intFromEnum(topic.Kind.data_column_sidecar)] = 1;
    try std.testing.expectError(error.InvalidTopic, g.prepareSubscriptions(&.{invalid}, w, now, 0));
    try std.testing.expect(g.overlay.findTopic(name) == null);
    try std.testing.expect(try g.prepareSubscriptions(sets, w, now, 0));
    g.commitSubscriptions(w);
    try std.testing.expect(!try g.prepareSubscriptions(sets, w, now, 1));
    g.commitSubscriptions(w);
}

test "compact intent resubscribes a pinned retained row with its score" {
    var g = try Gossipsub.init(std.testing.allocator, options());
    defer g.deinit();
    const w = try std.testing.allocator.create(local.Workspace);
    defer std.testing.allocator.destroy(w);
    w.* = .{};
    try std.testing.expect(try apply(&g, w, &.{name}));
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const logical = g.sessions.rows[peer.index].logical.index;
    g.peers.scores.invalid(logical, 0);
    try std.testing.expect(try apply(&g, w, &.{}));
    const counters = g.peers.scores.topics[@as(usize, logical) * g.overlay.rows.len];
    g.sessions.rows[peer.index].io.tx.subscription_dirty.set(0);
    try std.testing.expect(try apply(&g, w, &.{name}));
    try std.testing.expectEqualDeep(counters, g.peers.scores.topics[@as(usize, logical) * g.overlay.rows.len]);
    try std.testing.expect(g.overlay.rows[0].subscribed);
}

test "local intent startup kind scores activate on accepted slots without resetting topic history" {
    var opts = options();
    opts.topic_params = @splat(.{ .params = .{ .weight = 2 }, .mesh_delivery_start_slot = 3 });
    var g = try Gossipsub.init(std.testing.allocator, opts);
    defer g.deinit();
    const w = try std.testing.allocator.create(local.Workspace);
    defer std.testing.allocator.destroy(w);
    w.* = .{};
    const sets = topic_fixture.subscriptions(&.{ name, "/eth2/05060708/beacon_block/ssz_snappy" });
    try std.testing.expect(try g.prepareSubscriptions(sets, w, now, 0));
    g.commitSubscriptions(w);
    try std.testing.expectEqual(@as(f64, 0), g.peers.scores.topic_params[0].mesh_delivery_weight);
    try std.testing.expectEqualDeep(g.peers.scores.topic_params[0], g.peers.scores.topic_params[g.overlay.namespace.offsets[1][0]]);
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const logical = g.sessions.rows[peer.index].logical.index;
    g.peers.scores.invalid(logical, 0);
    const counters = g.peers.scores.topics[@as(usize, logical) * g.overlay.rows.len];
    try std.testing.expectError(error.InvalidTopic, g.prepareSubscriptions(&.{.{ .digest = @splat(255) }}, w, now, 3));
    try std.testing.expectEqual(@as(u64, 0), g.overlay.slot);
    try std.testing.expectEqual(@as(f64, 0), g.peers.scores.topic_params[0].mesh_delivery_threshold);
    try std.testing.expect(!try g.prepareSubscriptions(sets, w, now, 2));
    g.commitSubscriptions(w);
    try std.testing.expect(try g.prepareSubscriptions(sets, w, now, 3));
    g.commitSubscriptions(w);
    try std.testing.expectEqual(@as(f64, -1), g.peers.scores.topic_params[0].mesh_delivery_weight);
    try std.testing.expectEqual(@as(f64, 5), g.peers.scores.topic_params[0].mesh_delivery_threshold);
    try std.testing.expectEqualDeep(g.peers.scores.topic_params[0], g.peers.scores.topic_params[g.overlay.namespace.offsets[1][0]]);
    try std.testing.expectEqualDeep(counters, g.peers.scores.topics[@as(usize, logical) * g.overlay.rows.len]);
    try std.testing.expect(!try g.prepareSubscriptions(sets, w, now, 4));
    opts.topic_params.?[2].params.weight = std.math.nan(f64);
    try std.testing.expectError(error.InvalidLimits, Gossipsub.init(std.testing.allocator, opts));
}

test "resident topics above the live limit preserve pins scores diagnostics and session reuse" {
    const a = std.testing.allocator;
    var g = try Gossipsub.init(a, options());
    defer g.deinit();
    const high: u16 = 614;
    var bytes: [topic.topic_max_len]u8 = undefined;
    const high_name = topic.buildCanonical(g.overlay.namespace.topicAt(high), &bytes);
    try support.subscribe(&g, high_name);
    try std.testing.expectEqual(high, g.overlay.findTopic(high_name).?);
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const logical = g.sessions.rows[peer.index].logical;
    const tx = &g.sessions.rows[peer.index].io.tx;
    g.overlay.synchronize(tx, 1);
    try std.testing.expectEqual(@as(?u16, high), tx.nextSubscription());
    try std.testing.expect(tx.announce(high, high_name, true, &g.sessions.control_scratch, 1));
    try std.testing.expectEqual(@as(?u16, null), tx.nextSubscription());
    const message = g.messages.store.put(g.overlay.namespace.topicAt(high).name.kind, @splat(99), high_name, "payload").?;
    const handle = g.messages.validation.admit(&g.messages.store, &g.peers, message, logical, high, 1);
    g.messages.store.seal(message);
    try std.testing.expect(g.messages.validation.retainsTopic(high));
    g.peers.scores.invalid(logical.index, high);
    g.peers.addBackoff(logical, high, 1, 60_000);
    const diag = @import("diagnostics.zig");
    var page = try diag.Page.init(a, g.overlay.rows.len);
    defer page.deinit(a);
    try diag.capture(&g, 0, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }), &page);
    try std.testing.expectEqual(@as(u16, 1), page.topic_count);
    try std.testing.expectEqual(high, page.topics[0].index);
    try std.testing.expectEqual(high, page.peers[0].topics[0].index);
    try std.testing.expectEqual(@as(f64, 1), page.peers[0].topics[0].counters.invalid);
    try std.testing.expect(page.peers[0].topics[0].weights.p4 < 0);
    g.messages.validation.finish(&g.messages.store, &g.peers, handle, .ignore, 2);
    g.messages.validation.expire(&g.messages.store, &g.peers, 2 + g.options.validation_tombstone_ms);
    try std.testing.expect(!g.messages.validation.retainsTopic(high));
    const masks = tx.subscription_dirty.masks;
    g.connectionClosed(g.sessions.rows[peer.index].conn);
    try std.testing.expectEqual(@as(usize, 0), tx.subscription_dirty.count());
    const replacement = support.addPeer(&g, .{ .index = 1, .generation = 2 }, .v1_2).?;
    const reused = &g.sessions.rows[replacement.index].io.tx;
    try std.testing.expectEqual(masks, reused.subscription_dirty.masks);
    try std.testing.expectEqual(@as(usize, 1), reused.subscription_dirty.count());
    g.overlay.synchronize(reused, 3);
    try std.testing.expectEqual(@as(?u16, high), reused.nextSubscription());
    g.cycle.begin(g.sessions, &g.peers, 3, false, g.overlay.rng.random());
    var seen: std.DynamicBitSetUnmanaged = try .initEmpty(std.testing.allocator, g.overlay.rows.len);
    defer seen.deinit(std.testing.allocator);
    var visited: usize = 0;
    for (0..g.overlay.rows.len) |_| {
        const index = g.cycle.next() orelse return error.TestUnexpectedResult;
        try std.testing.expect(!seen.isSet(index));
        seen.set(index);
        visited += 1;
    }
    try std.testing.expect(g.cycle.next() == null);
    try std.testing.expectEqual(g.overlay.rows.len, visited);
    try std.testing.expectEqual(@as(?u64, 1), g.cycle.complete());
}

test "resident allocation accounting follows namespace dimensions and frees every prefix" {
    const a = std.testing.allocator;
    var measured = std.testing.FailingAllocator.init(a, .{});
    var opts = options();
    opts.mcache_arena_bytes = constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE) + message_store.page_bytes;
    var g = try Gossipsub.init(measured.allocator(), opts);
    try std.testing.expectEqual(g.overlay.namespace.topic_count, g.overlay.rows.len);
    try std.testing.expectEqual(measured.allocated_bytes, g.memoryPlan().total_bytes - @sizeOf(Gossipsub));
    g.deinit();
    try std.testing.expectEqual(measured.allocated_bytes, measured.freed_bytes);
    for (0..measured.alloc_index) |prefix| {
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = prefix });
        try std.testing.expectError(error.OutOfMemory, Gossipsub.init(failing.allocator(), opts));
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    }
}

test "resident score and bitset dimensions cover the validated namespace maximum" {
    const a = std.testing.allocator;
    const score = @import("score.zig");
    for ([_]usize{ 1, 65, 615, 1082, topic_policy.topic_max }) |count| {
        var measured = std.testing.FailingAllocator.init(a, .{});
        var scores = try score.PeerScore.initForTopics(measured.allocator(), .{}, 2, count);
        try std.testing.expectEqual(score.PeerScore.backingBytesForTopics(2, count), measured.allocated_bytes);
        const last: u16 = @intCast(count - 1);
        scores.invalid(1, last);
        try std.testing.expectEqual(@as(f64, 0), scores.snapshot(0, 1, 1));
        try std.testing.expect(scores.snapshot(1, 1, 1) < 0);
        scores.resetTopic(last);
        try std.testing.expectEqual(@as(f64, 0), scores.snapshot(1, 1, 1));
        scores.deinit(measured.allocator());
        try std.testing.expectEqual(measured.allocated_bytes, measured.freed_bytes);
        var workspace: local.Workspace = .{};
        workspace.desired.set(last);
        try std.testing.expectEqual(@as(usize, 1), workspace.desired.count());
    }
}

test "local intent keeps namespace identities across subscription order and expiry" {
    var g = try Gossipsub.init(std.testing.allocator, options());
    defer g.deinit();
    var workspace: local.Workspace = .{};
    const first = g.overlay.namespace.lookup(name).?.ordinal;
    const second = g.overlay.namespace.lookup(next).?.ordinal;
    const borrowed = g.overlay.topicString(first);
    try std.testing.expect(try apply(&g, &workspace, &.{next}));
    try std.testing.expectEqual(second, g.overlay.findTopic(next).?);
    try std.testing.expect(try apply(&g, &workspace, &.{ name, next }));
    try std.testing.expectEqual(first, g.overlay.findTopic(name).?);
    try std.testing.expect(!try apply(&g, &workspace, &.{ next, name }));
    try std.testing.expect(try apply(&g, &workspace, &.{}));
    g.overlay.expireTopic(&g.overlayContext(now.millis()), first, false);
    g.overlay.expireTopic(&g.overlayContext(now.millis()), second, false);
    try std.testing.expect(g.overlay.findTopic(name) == null and g.overlay.findTopic(next) == null);
    try std.testing.expectEqualStrings(name, borrowed);
    try std.testing.expect(try apply(&g, &workspace, &.{ next, name }));
    try std.testing.expectEqual(first, g.overlay.findTopic(name).?);
    try std.testing.expectEqual(second, g.overlay.findTopic(next).?);
}

test "topic expiry preserves attribution announcements and backoff independently" {
    var opts = options();
    opts.retained_score_ms = 10;
    var g = try Gossipsub.init(std.testing.allocator, opts);
    defer g.deinit();
    try support.subscribe(&g, name);
    const index = g.overlay.findTopic(name).?;
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const peer = g.sessions.rows[session.index].logical;
    const tx = &g.sessions.rows[session.index].io.tx;
    const message = g.messages.store.put(.beacon_block, @splat(1), name, "payload").?;
    const handle = g.messages.validation.admit(&g.messages.store, &g.peers, message, peer, index, 0);
    g.messages.store.seal(message);
    g.peers.scores.invalid(peer.index, index);
    try support.unsubscribe(&g, name);
    tx.subscription_dirty.set(index);
    g.peers.addBackoff(peer, index, 0, 60_000);
    try std.testing.expect(g.peers.score(peer, 11) < 0);
    g.overlay.expireTopic(&g.overlayContext(11), index, g.messages.validation.retainsTopic(index));
    try std.testing.expect(g.peers.scores.retainsTopic(index));
    g.messages.validation.finish(&g.messages.store, &g.peers, handle, .ignore, 11);
    g.overlay.expireTopic(&g.overlayContext(11), index, g.messages.validation.retainsTopic(index));
    try std.testing.expect(g.peers.scores.retainsTopic(index));
    const expired = 11 + g.options.validation_tombstone_ms;
    g.messages.validation.expire(&g.messages.store, &g.peers, expired);
    try std.testing.expect(!g.messages.validation.retainsTopic(index));
    g.overlay.expireTopic(&g.overlayContext(expired), index, false);
    try std.testing.expect(g.peers.scores.retainsTopic(index));
    tx.subscription_dirty.unset(index);
    g.overlay.expireTopic(&g.overlayContext(expired), index, false);
    try std.testing.expectEqual(@as(f64, 0), g.peers.score(peer, expired));
    try std.testing.expect(g.peers.backedOff(peer, index, expired));
    try std.testing.expect(g.overlay.rows[index].active);
    g.overlay.expireTopic(&g.overlayContext(60_000), index, false);
    try std.testing.expect(!g.overlay.rows[index].active);
    try std.testing.expect(!g.peers.backedOff(peer, index, 60_000));
}

test "known inactive topics ignore remote mesh controls" {
    var g = try Gossipsub.init(std.testing.allocator, options());
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const peer = g.sessions.rows[session.index].logical;
    const index = g.overlay.namespace.lookup(name).?.ordinal;
    support.control(&g, session.index, .{ .prune = .{ .topic = name, .backoff = 60 } }, now);
    support.control(&g, session.index, .{ .graft = name }, now);
    try std.testing.expect(!g.overlay.rows[index].active);
    try std.testing.expect(!g.peers.backedOff(peer, index, now.millis()));
    try support.subscribe(&g, name);
    try support.unsubscribe(&g, name);
    g.cancelWrites(session);
    g.overlay.expireTopic(&g.overlayContext(now.millis()), index, false);
    try std.testing.expect(!g.overlay.rows[index].active);
    support.control(&g, session.index, .{ .prune = .{ .topic = name, .backoff = 60 } }, now);
    try std.testing.expect(!g.peers.backedOff(peer, index, now.millis()));
}

test "topic expiry invalidates positive and negative cached scores" {
    for ([_]bool{ false, true }) |negative| {
        var opts = options();
        opts.retained_score_ms = 10;
        var g = try Gossipsub.init(std.testing.allocator, opts);
        defer g.deinit();
        try support.subscribe(&g, name);
        const index = g.overlay.findTopic(name).?;
        const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
        const peer = g.sessions.rows[session.index].logical;
        if (negative) g.peers.scores.invalid(peer.index, index) else g.peers.scores.deliverEligible(peer.index, index, false);
        try support.unsubscribe(&g, name);
        g.cancelWrites(session);
        try std.testing.expectEqual(@as(f64, if (negative) -100 else 1), g.peers.score(peer, 10));
        g.overlay.expireTopic(&g.overlayContext(10), index, false);
        try std.testing.expectEqual(@as(f64, 0), g.peers.score(peer, 10));
        try support.subscribe(&g, name);
        try std.testing.expectEqual(index, g.overlay.findTopic(name).?);
        try std.testing.expectEqual(@as(f64, 0), g.peers.score(peer, 10));
    }
}
