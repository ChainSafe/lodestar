const constants = @import("constants.zig");
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const MessageId = Gossipsub.MessageId;
const protobuf = @import("protobuf.zig");
const Now = @import("../types.zig").Now;
const Credits = @import("turn.zig").Credits;
const Progress = @import("turn.zig").Progress;
const snappy = @import("snappy");
const receiveForTest = support.receiveMessage;
const testMessage = support.message;
const IwantOutcome = @import("metrics.zig").IwantOutcome;
const delivery = @import("delivery.zig");
const StorageRefusal = @import("messages.zig").StorageRefusal;
const topic_policy = @import("topic_policy.zig");
const turn_mod = @import("turn.zig");
const session_io = @import("session_io.zig");
const outbox = @import("outbox.zig");
const frame = @import("frame.zig");
const RpcCounters = @import("metrics.zig").RpcCounters;

fn ids(out: []u8, field: u32, list: []const MessageId) []const u8 {
    var writer = protobuf.Writer.init(out);
    for (list) |*id| writer.bytesField(field, id);
    return writer.written();
}

test "IWANT ignores IDONTWANT while preserving retransmission and queue limits" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    g.sessions.rows[peer.index].io.tx.cancelStream();
    var known: [3]MessageId = undefined;
    for (&known, 0..) |*id, i| {
        var text: [8]u8 = undefined;
        const payload = try std.fmt.bufPrint(&text, "iwant {d}", .{i});
        _ = try g.publish(test_topic, payload, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
        id.* = topic_mod.validMessageId(test_topic, payload, .{});
    }
    var body: [256]u8 = undefined;
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 });
    support.control(&g, peer.index, .{ .idontwant = .{ .body = ids(&body, 1, &.{known[2]}) } }, now);
    try std.testing.expect(g.sessions.suppresses(peer.index, known[2], now.millis()));
    const unknown: MessageId = @splat(9);
    support.control(&g, peer.index, .{ .iwant = .{ .body = ids(&body, 1, &.{ unknown, known[2], known[0], known[0], known[0], known[0] }) } }, now);
    const tx = &g.sessions.rows[peer.index].io.tx;
    const h = g.messages.history.message(g.messages.history.get(&g.messages.store, known[0]).?);
    for (0..delivery.per_peer_limit) |_| {
        if (tx.data.full()) break;
        _ = tx.queueData(&g.messages.store, h, .forward, .{ .bytes = constants.tx_peer_bytes }, 2);
    }
    support.control(&g, peer.index, .{ .iwant = .{ .body = ids(&body, 1, &.{known[1]}) } }, now);
    for ([_]IwantOutcome{ .miss, .limited, .queued, .refused }, [_]u64{ 1, 1, 4, 1 }) |outcome, count| {
        try std.testing.expectEqual(count, g.iwant_outcomes[@intFromEnum(outcome)]);
    }
    g.cancelWrites(g.sessions.ref(peer.index));
}

test "gossip counts each consumed message once by topic kind and never on a work retry" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var compressed: [64]u8 = undefined;
    const message: protobuf.Message = .{ .topic = name, .data = compressed[0..try snappy.raw.compress("payload", &compressed)] };
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    var turn = turn_mod.Turn.init(&g.options, now, g.msg_scratch);
    turn.sink = g.message_sink;
    turn.large_used = true;
    turn.budget.work = 0;
    var credits = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.credits, g.receiveItem(g.sessions.ref(peer.index), .{ .message = message }, &turn, &credits));
    const counts = g.topic_metrics.get(name);
    try std.testing.expectEqual(@as(u64, 0), counts.received);
    try std.testing.expectEqual(@as(?usize, 1), receiveForTest(&g, peer.index, message, now));
    try std.testing.expectEqual(@as(?usize, 0), receiveForTest(&g, peer.index, message, now));
    try std.testing.expectEqual(@as(?usize, 0), receiveForTest(&g, peer.index, .{ .topic = name, .data = &.{5} }, now));
    try std.testing.expectEqual(@as(f64, 1), support.invalidDeliveries(&g));
    inbox.full = true;
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, peer.index, "refused", 1));
    try std.testing.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(StorageRefusal.processor_capacity)]);
    try std.testing.expectEqual(@as(u64, 4), counts.received);
    try std.testing.expectEqual(@as(u64, 1), counts.duplicate);
    const unsubscribed = "/eth2/01020304/voluntary_exit/ssz_snappy";
    const unknown = "/eth2/01020304/beacon_blocks/ssz_snappy";
    for ([_][]const u8{ unsubscribed, unknown, unknown }) |topic| {
        try std.testing.expectEqual(@as(?usize, 0), receiveForTest(&g, peer.index, .{ .topic = topic, .data = message.data }, now));
    }
    try std.testing.expectEqual(@as(u64, 1), g.topic_metrics.get(unsubscribed).received);
    try std.testing.expectEqual(@as(u64, 2), g.topic_metrics.counts[topic_policy.kind_count].received);
    try std.testing.expectEqual(@as(u64, 4), counts.received);
    for (g.topic_metrics.counts) |kind| try std.testing.expectEqual(@as(u64, 0), kind.published);
}

test "gossip RPC receive metrics count complete validated frames before handling and survive retries" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    var body: [128]u8 = undefined;
    var control: [512]u8 = undefined;
    var cw = protobuf.Writer.init(&control);
    var item = protobuf.Writer.init(&body);
    item.bytesField(1, "unknown");
    item.bytesField(2, &(@as(MessageId, @splat(1))));
    item.bytesField(2, &(@as(MessageId, @splat(2))));
    cw.bytesField(1, item.written());
    cw.bytesField(1, item.written());
    item = protobuf.Writer.init(&body);
    item.bytesField(1, &(@as(MessageId, @splat(3))));
    cw.bytesField(2, item.written());
    cw.bytesField(5, item.written());
    item = protobuf.Writer.init(&body);
    item.bytesField(1, "unknown");
    cw.bytesField(3, item.written());
    cw.bytesField(4, item.written());
    var bytes: [1024]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    protobuf.writeSubscription(&writer, true, "unknown");
    protobuf.writeSubscription(&writer, false, "unknown");
    protobuf.writeMessage(&writer, "same", "unknown");
    protobuf.writeMessage(&writer, "same", "unknown");
    writer.bytesField(3, cw.written());
    const io = &g.sessions.rows[peer.index].io;
    io.startRpc(writer.written());
    var turn = turn_mod.Turn.init(&g.options, now, g.msg_scratch);
    var credits = Credits.peer(&g.options);
    turn.budget.fields = 1;
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, peer.index, &turn, &credits));
    try std.testing.expectEqualDeep(RpcCounters{}, g.rpc_received);

    const expected: RpcCounters = .{ .count = 1, .bytes = writer.len, .subscription = 2, .message = 2, .control = 1, .ihave = 2, .iwant = 1, .graft = 1, .prune = 1, .idontwant = 1 };
    for (0..32) |_| {
        turn = turn_mod.Turn.init(&g.options, now, g.msg_scratch);
        credits = Credits.peer(&g.options);
        credits.items = 1;
        const result = try session_io.processRpc(&g, peer.index, &turn, &credits);
        try std.testing.expectEqualDeep(expected, g.rpc_received);
        if (result == .done) break;
    } else return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u64, 2), g.topic_metrics.get("unknown").received);
    turn = turn_mod.Turn.init(&g.options, now, g.msg_scratch);
    credits = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, peer.index, &turn, &credits));
    try std.testing.expectEqualDeep(expected, g.rpc_received);

    io.finishFrame();
    writer.bytes(&.{ 0x1a, 0 });
    io.startRpc(writer.written());
    turn = turn_mod.Turn.init(&g.options, now, g.msg_scratch);
    credits = Credits.peer(&g.options);
    try std.testing.expectError(error.DuplicateField, session_io.processRpc(&g, peer.index, &turn, &credits));
    try std.testing.expectEqualDeep(expected, g.rpc_received);

    io.finishFrame();
    io.startRpc(&.{ 0x1a, 0 });
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, peer.index, &turn, &credits));
    try std.testing.expectEqual(@as(u64, 2), g.rpc_received.count);
    try std.testing.expectEqual(@as(u64, 2), g.rpc_received.control);
    try std.testing.expectEqual(expected.bytes + 2, g.rpc_received.bytes);
    g.connectionClosed(g.sessions.rows[peer.index].conn);
    try std.testing.expectEqual(@as(u64, 2), g.rpc_received.count);
}

test "gossip RPC send metrics count admitted controls and batches without counting partial writes or refusals" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const tx = &g.sessions.rows[peer.index].io.tx;
    const message_ids = [_]MessageId{ @splat(1), @splat(2) };
    const controls = [_]outbox.Control{
        .{ .subscription = .{ .topic = test_topic, .subscribed = true } },
        .{ .graft = test_topic },
        .{ .prune = .{ .topic = test_topic, .backoff_s = 60 } },
        .{ .ihave = .{ .topic = test_topic, .ids = &message_ids } },
        .{ .iwant = &message_ids },
        .{ .idontwant = &message_ids },
    };
    for (&controls) |*control| try std.testing.expect(tx.submit(control, &g.sessions.control_scratch, 1) != null);
    try std.testing.expect(tx.gossipTopic(test_topic, &message_ids));
    try std.testing.expect(tx.gossipTopic(test_topic, &message_ids));
    try std.testing.expectEqual(@as(u64, 6), tx.rpc_sent.count);
    try std.testing.expect(tx.finishGossip(1));
    const admitted = tx.rpc_sent;
    var expected: RpcCounters = .{ .count = 7, .subscription = 1, .control = 6, .ihave = 3, .iwant = 1, .graft = 1, .prune = 1, .idontwant = 1 };
    var reader: frame.Reader = .{};
    var body: [1024]u8 = undefined;
    var frames: usize = 0;
    for (0..4096) |_| {
        const segment = tx.segment(&g.messages.store, 0);
        if (segment.len == 0) break;
        const decoded = try reader.feed(segment[0..1], &body);
        _ = tx.advance(1);
        if (decoded.frame) |rpc| {
            frames += 1;
            expected.bytes += rpc.len;
        }
        try std.testing.expectEqualDeep(admitted, tx.rpc_sent);
    } else return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(usize, 7), frames);
    try std.testing.expectEqualDeep(expected, tx.rpc_sent);
    for (0..outbox.control_frames + 1) |_| {
        if (tx.submit(&controls[4], &g.sessions.control_scratch, 2) == null) break;
    } else return error.TestUnexpectedResult;
    const full = tx.rpc_sent;
    try std.testing.expect(tx.submit(&controls[4], &g.sessions.control_scratch, 2) == null);
    try std.testing.expect(tx.gossipTopic(test_topic, &message_ids));
    try std.testing.expect(!tx.finishGossip(2));
    try std.testing.expectEqualDeep(full, tx.rpc_sent);
    g.cancelWrites(peer);
    tx.startSession();
    try std.testing.expectEqualDeep(full, tx.rpc_sent);
    try std.testing.expect(!tx.finishGossip(3));
    g.connectionClosed(g.sessions.rows[peer.index].conn);
    try std.testing.expectEqualDeep(full, g.retired_rpc_sent);
    try std.testing.expectEqualDeep(RpcCounters{}, tx.rpc_sent);
    const reused = support.addPeer(&g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    try std.testing.expectEqual(peer.index, reused.index);
    try std.testing.expectEqualDeep(RpcCounters{}, g.sessions.rows[reused.index].io.tx.rpc_sent);
}
