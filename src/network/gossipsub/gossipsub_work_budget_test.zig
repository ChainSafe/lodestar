const topic_fixture = @import("topic_fixture.zig");
const topic_mod = @import("topic.zig");
const Now = @import("../types.zig").Now;
const schedule_test_support = @import("../schedule_test_support.zig");
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const Engine = @import("../quic/Engine.zig");
const MessageId = Gossipsub.MessageId;
const constants = @import("constants.zig");
const rpc_handler = @import("rpc_handler.zig");
const protobuf = @import("protobuf.zig");
const StreamHandle = Engine.StreamHandle;
const Credits = @import("turn.zig").Credits;
const Progress = @import("turn.zig").Progress;
const snappy = @import("snappy");
const test_support = @import("../quic/test_support.zig");
const turn_mod = @import("turn.zig");
const configuration = @import("../configuration.zig");
const policy_fixture = @import("../reqresp/policy_fixture.zig");
const session_io = @import("session_io.zig");
const IwantOutcome = @import("metrics.zig").IwantOutcome;

test "gossip turn separates credit exhaustion from host pressure and preserves event borrows" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .work_per_pump = 1, .decompress_per_peer_bytes = 1 });
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var encoded: [256]u8 = undefined;
    var compressed: [64]u8 = undefined;
    var writer = protobuf.Writer.init(&encoded);
    for ([_][]const u8{ "first", "second" }) |payload| {
        const len = try snappy.raw.compress(payload, &compressed);
        protobuf.writeMessage(&writer, compressed[0..len], name);
    }
    const io = &g.sessions.rows[session.index].io;
    io.startRpc(writer.written());
    var turn = Gossipsub.beginPump(&g, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    var peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expect(io.rpc.?.item != null);
}

test "gossipsub rotates the legal atomic allowance past a duplicate flood" {
    var pair: test_support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .decompress_per_peer_bytes = 1 });
    defer g.deinit();
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var first_rpc: [128]u8 = undefined;
    var second_rpc: [128]u8 = undefined;
    var compressed: [64]u8 = undefined;
    var w1 = protobuf.Writer.init(&first_rpc);
    var w2 = protobuf.Writer.init(&second_rpc);
    const n1 = try snappy.raw.compress("one", &compressed);
    protobuf.writeMessage(&w1, compressed[0..n1], topic);
    const n2 = try snappy.raw.compress("two", &compressed);
    protobuf.writeMessage(&w2, compressed[0..n2], topic);
    const first = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const second = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const stream1: StreamHandle = .{ .conn = .{ .index = 0, .generation = 1 }, .slot = 0, .id = 0 };
    const stream2: StreamHandle = .{ .conn = .{ .index = 1, .generation = 1 }, .slot = 0, .id = 0 };
    g.sessions.rows[first.index].in_stream = stream1;
    g.sessions.rows[first.index].io.rx_ready = true;
    g.sessions.rows[second.index].in_stream = stream2;
    g.sessions.rows[second.index].io.rx_ready = true;
    g.sessions.rows[first.index].io.startRpc(w1.written());
    g.sessions.rows[second.index].io.startRpc(w2.written());
    g.settle(first.index);
    g.settle(second.index);
    try std.testing.expectEqual(@as(usize, 1), support.pump(&g, &pair.server, pair.now));
    try std.testing.expectEqualStrings("one", inbox.last().bytes);
    g.sessions.rows[first.index].in_stream = stream1;
    g.sessions.rows[first.index].io.rx_ready = true;
    g.sessions.rows[first.index].io.startRpc(w1.written());
    g.settle(first.index);
    try std.testing.expectEqual(@as(?u64, pair.now.millis()), schedule_test_support.wakeupMilliseconds(g.schedule(), pair.now.millis()));
    try std.testing.expectEqual(@as(usize, 1), support.pump(&g, &pair.server, pair.now));
    try std.testing.expectEqualStrings("two", inbox.last().bytes);
}

test "gossipsub IHAVE work preflight defers without consuming the advertisement" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var bytes: [4096]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    protobuf.beginIhaveRpc(&writer, name, 128, constants.message_id_length);
    const id: MessageId = @splat(7);
    for (0..128) |_| protobuf.writeIhaveId(&writer, &id);
    const io = &g.sessions.rows[session.index].io;
    io.startRpc(writer.written());
    var turn = turn_mod.Turn.init(&g.options, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }), &.{});
    var peer = Credits.peer(&g.options);
    turn.budget.work = 0;
    for (0..2) |_| {
        try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
        try std.testing.expectEqual(@as(u64, 1), g.rpc_received.count);
        try std.testing.expectEqual(@as(u64, 1), g.rpc_received.ihave);
        try std.testing.expectEqual(writer.len, g.rpc_received.bytes);
        try std.testing.expectEqual(@as(u16, 0), io.ihave_recv);
        try std.testing.expect(io.rpc.?.item != null);
        try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
        try std.testing.expect(!turn.large_used);
    }
    const cost = rpc_handler.ihaveWork(&g, io.rpc.?.item.?.bytes.len);
    try std.testing.expect(cost > writer.len);
    turn.budget.work = cost;
    peer.work = cost - 1;
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expectEqual(cost, turn.budget.work);
    try std.testing.expectEqual(@as(u16, 0), io.ihave_recv);
    peer.work = cost;
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expectEqual(@as(usize, 0), turn.budget.work);
    try std.testing.expectEqual(@as(usize, 0), peer.work);
    try std.testing.expectEqual(@as(u16, 1), io.ihave_recv);
    try std.testing.expect(io.rpc.?.item == null);
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    try std.testing.expect(!g.sessions.finishFrame(io));
    io.startRpc(writer.written());
    turn = turn_mod.Turn.init(&g.options, turn.now, &.{});
    peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
}

test "gossipsub IWANT work preflight defers all replies and resumes exactly once" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    var ids: [3]MessageId = undefined;
    for ([_][]const u8{ "first", "second" }, 0..) |payload, i| {
        _ = try g.publish(name, payload, now);
        ids[i] = topic_mod.validMessageId(name, payload, .{});
    }
    ids[2] = @splat(7);
    var bytes: [128]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    protobuf.beginIwantRpc(&writer, ids.len, constants.message_id_length);
    for (&ids) |*id| protobuf.writeIwantId(&writer, id);
    const io = &g.sessions.rows[session.index].io;
    io.startRpc(writer.written());
    var turn = turn_mod.Turn.init(&g.options, now, &.{});
    var peer = Credits.peer(&g.options);
    turn.budget.work = 0;
    for (0..2) |_| {
        try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
        try std.testing.expect(io.rpc.?.item != null);
        try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);
        for (g.iwant_outcomes) |count| try std.testing.expectEqual(@as(u64, 0), count);
        try std.testing.expect(!turn.large_used);
    }
    turn.budget.work = g.options.work_per_pump;
    peer.work = 0;
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expectEqual(g.options.work_per_pump, turn.budget.work);
    try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);

    peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expect(turn.budget.work < g.options.work_per_pump);
    try std.testing.expect(peer.work < g.options.decompress_per_peer_bytes);
    try std.testing.expect(io.rpc.?.item == null);
    try std.testing.expectEqual(@as(usize, 2), io.tx.data.count);
    try std.testing.expectEqual(@as(u64, 2), g.iwant_outcomes[@intFromEnum(IwantOutcome.queued)]);
    try std.testing.expectEqual(@as(u64, 1), g.iwant_outcomes[@intFromEnum(IwantOutcome.miss)]);
    for (ids[0..2]) |id| {
        const slot = g.messages.history.get(&g.messages.store, id).?;
        try std.testing.expect(!g.messages.history.iwantAllowed(slot, g.sessions.rows[session.index].logical, 1));
        try std.testing.expect(g.messages.history.iwantAllowed(slot, g.sessions.rows[session.index].logical, 2));
    }
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expectEqual(@as(usize, 2), io.tx.data.count);
    try std.testing.expectEqual(@as(u64, 2), g.iwant_outcomes[@intFromEnum(IwantOutcome.queued)]);
    try std.testing.expectEqual(@as(u64, 1), g.rpc_received.count);
    try std.testing.expectEqual(@as(u64, 2), io.tx.rpc_sent.message);
}

test "gossipsub maximum IWANT shares oversized allowance with data and makes progress" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .work_per_pump = 1, .decompress_per_peer_bytes = 1 });
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const bytes = try std.testing.allocator.alloc(u8, 128 * 1024);
    defer std.testing.allocator.free(bytes);
    var writer = protobuf.Writer.init(bytes);
    protobuf.beginIwantRpc(&writer, constants.max_iwant_ids_per_rpc, constants.message_id_length);
    const id: MessageId = @splat(7);
    for (0..constants.max_iwant_ids_per_rpc) |_| protobuf.writeIwantId(&writer, &id);
    var compressed: [64]u8 = undefined;
    const len = try snappy.raw.compress("payload", &compressed);
    protobuf.writeMessage(&writer, compressed[0..len], name);
    const io = &g.sessions.rows[session.index].io;
    io.startRpc(writer.written());
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var turn = Gossipsub.beginPump(&g, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    var peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expect(turn.large_used);
    try std.testing.expect(io.rpc.?.item != null);
    try std.testing.expectEqual(@as(u64, constants.max_iwant_ids_per_rpc), g.iwant_outcomes[@intFromEnum(IwantOutcome.miss)]);
    try std.testing.expectEqual(@as(usize, 0), inbox.count);
    turn = Gossipsub.beginPump(&g, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expect(turn.large_used);
    try std.testing.expectEqual(@as(u64, constants.max_iwant_ids_per_rpc), g.iwant_outcomes[@intFromEnum(IwantOutcome.miss)]);
    try std.testing.expectEqual(@as(usize, 1), inbox.count);
    try std.testing.expectEqualStrings("payload", inbox.last().bytes);
}

test "gossipsub IHAVE maximum advertisement shares oversized allowance with data and makes progress" {
    const fixture = try configuration.resolve(.{ .gossip = .{ .topic_policy = comptime &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })}, .receive_arena_bytes = 16 * 1024 * 1024 }, .limits = .{ .connections_max = 16, .handshaking_max = 8, .dialing_max = 4 }, .peers = .{ .capacity = 64, .outbound_reserve = 4, .target_peers = 8, .max_peers = 12, .min_outbound = 2 }, .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
    var options = fixture.core.protocols.gossipsub;
    options.work_per_pump = 1;
    options.decompress_per_peer_bytes = 1;
    var g = try support.init(std.testing.allocator, options);
    defer g.deinit();
    const session = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const bytes = try std.testing.allocator.alloc(u8, 128 * 1024);
    defer std.testing.allocator.free(bytes);
    var writer = protobuf.Writer.init(bytes);
    const wire_pb = @import("../wire/protobuf.zig");
    const long = wire_pb.bytesFieldSize(1, name.len) + constants.max_ihave_ids_per_heartbeat * wire_pb.bytesFieldSize(2, constants.message_id_length);
    const short = wire_pb.bytesFieldSize(1, name.len) + wire_pb.bytesFieldSize(2, constants.message_id_length);
    writer.tag(3, protobuf.wire_len);
    writer.varint(wire_pb.bytesFieldSize(1, long) + wire_pb.bytesFieldSize(1, short));
    writer.tag(1, protobuf.wire_len);
    writer.varint(long);
    writer.bytesField(1, name);
    const id: MessageId = @splat(7);
    for (0..constants.max_ihave_ids_per_heartbeat) |_| protobuf.writeIhaveId(&writer, &id);
    writer.tag(1, protobuf.wire_len);
    writer.varint(short);
    writer.bytesField(1, name);
    protobuf.writeIhaveId(&writer, &id);
    var compressed: [64]u8 = undefined;
    const len = try snappy.raw.compress("payload", &compressed);
    protobuf.writeMessage(&writer, compressed[0..len], name);
    const io = &g.sessions.rows[session.index].io;
    io.startRpc(writer.written());
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var scratch: [64]u8 = undefined;
    var turn = turn_mod.Turn.init(&g.options, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }), &scratch);
    turn.sink = g.message_sink;
    var peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expect(turn.large_used);
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    try std.testing.expectEqual(@as(u16, 1), io.ihave_recv);
    turn = turn_mod.Turn.init(&g.options, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }), &scratch);
    turn.sink = g.message_sink;
    peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.credits, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expect(turn.large_used);
    try std.testing.expectEqual(@as(u16, 1), io.ihave_recv);
    turn = turn_mod.Turn.init(&g.options, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }), &scratch);
    turn.sink = g.message_sink;
    peer = Credits.peer(&g.options);
    try std.testing.expectEqual(Progress.done, try session_io.processRpc(&g, session.index, &turn, &peer));
    try std.testing.expectEqual(@as(usize, 1), inbox.count);
    try std.testing.expectEqualStrings("payload", inbox.last().bytes);
    try std.testing.expect(turn.large_used);
    try std.testing.expectEqual(@as(u16, 1), io.ihave_recv);
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
}
