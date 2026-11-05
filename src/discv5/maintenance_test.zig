const std = @import("std");
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const enr = @import("identity/enr.zig");
const Lookup = @import("Lookup.zig");
const Maintenance = @import("Maintenance.zig");
const message = @import("wire/message.zig");
const test_support = @import("test_support.zig");
const RoutingTable = @import("RoutingTable.zig");
const crypto = @import("identity/crypto.zig");

const sealEntropy = test_support.sealEntropy;

test "maintenance probes a quiet partial table on its explicit timer and retries only twice" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const remote = try record(2, 1);
    const peer = test_support.endpoint(&remote);
    _ = try core.confirmPeer(&peer, &remote, 0);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    try std.testing.expectEqual(@as(?u64, 10), controller.nextDeadlineMs(&core));
    try std.testing.expect((try controller.startNext(
        &core,
        &out,
        try message.RequestId.init(&.{1}),
        9,
        &sealEntropy(1),
    )) == null);
    const first = (try controller.startNext(
        &core,
        &out,
        try message.RequestId.init(&.{1}),
        10,
        &sealEntropy(1),
    )).?;
    try std.testing.expectEqual(peer, first.peer);
    try std.testing.expectEqual(@as(usize, 1), core.calls.count());
    var expired: [4]CallTable.Expired = undefined;
    const tick = core.expire(110, &expired);
    try std.testing.expectEqual(@as(usize, 1), tick.calls);
    try std.testing.expect(controller.onFailure(&core, expired[0].handle, 110, .expired));
    try std.testing.expectEqual(@as(?u64, 115), controller.nextDeadlineMs(&core));
    const retry = (try controller.startNext(
        &core,
        &out,
        try message.RequestId.init(&.{2}),
        115,
        &sealEntropy(2),
    )).?;
    _ = core.expire(215, &expired);
    try std.testing.expect(controller.onFailure(&core, retry.call.handle, 215, .expired));
    try std.testing.expectEqual(@as(usize, 1), core.peerCount());
    try std.testing.expect(core.peerRecord(&peer.node_id).?.last_verified_ms == null);
    try std.testing.expect((try start(&controller, &core, &out, 3, 1000)) == null);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());

    const candidates = try std.testing.allocator.create(Lookup.Candidates);
    defer std.testing.allocator.destroy(candidates);

    var seeds: [Lookup.result_max]RoutingTable.Entry = undefined;
    const closest = core.closestNodes(&peer.node_id, &seeds);
    var lookup: Lookup = undefined;
    try lookup.init(candidates, core.localRecord().node_id, peer.node_id, closest, .dual);
    defer lookup.cancel(&core);
    const next = (try lookup.startNext(&core, &out, try .init(&.{4}), 1001, &sealEntropy(4))).?;
    try std.testing.expectEqual(peer, next.peer);
}

test "maintenance preserves unrelated failures and local send failure retains peer" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const remote = try record(2, 1);
    const peer = test_support.endpoint(&remote);
    _ = try core.confirmPeer(&peer, &remote, 0);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const first = (try controller.startNext(
        &core,
        &out,
        try message.RequestId.init(&.{1}),
        10,
        &sealEntropy(1),
    )).?;
    var unrelated = first.call.handle;
    unrelated.generation += 1;
    try std.testing.expect(!controller.onFailure(&core, unrelated, 11, .expired));
    try std.testing.expect(controller.onFailure(&core, first.call.handle, 11, .local));
    try std.testing.expectEqual(@as(usize, 1), core.peerCount());
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

fn testConfig() Maintenance.Config {
    return .{
        .probe_interval_ms = 10,
        .stale_after_ms = 10,
        .retry_interval_ms = 5,
    };
}

fn record(seed: u8, sequence: u64) !enr.Record {
    const key = try test_support.keyPair(seed);
    return enr.Record.create(
        &key,
        sequence,
        test_support.address4(203, seed, 1, 1, 9_000 + @as(u16, seed)),
    );
}

fn initEngine() !Engine {
    const key = try test_support.keyPair(1);
    const local_record = try record(1, 1);
    var core: Engine = undefined;
    try core.init(std.testing.allocator, key, local_record, test_support.engineConfig());
    return core;
}

test "maintenance retrieves a newer self ENR from authenticated PONG through FINDNODE zero" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const old_record = try record(2, 1);
    const newer_record = try record(2, 2);
    const peer = test_support.endpoint(&old_record);
    _ = try core.confirmPeer(&peer, &old_record, 0);
    test_support.installSession(&core, peer, 0x55);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const ping_id = try message.RequestId.init(&.{1});
    _ = (try controller.startNext(&core, &out, ping_id, 10, &sealEntropy(1))).?;
    const pong = message.Message{ .pong = .{
        .request_id = ping_id,
        .enr_sequence = 2,
        .recipient_ip = .{ .ip4 = .{ 203, 1, 1, 1 } },
        .recipient_port = 9_001,
    } };
    try respond(&core, &controller, &newer_record, &pong, 11, 20);
    const nodes_id = try message.RequestId.init(&.{2});
    const fetch = (try controller.startNext(&core, &out, nodes_id, 11, &sealEntropy(2))).?;
    var decode_scratch: message.DecodeScratch = .{};
    const request = try message.Message.decode(
        core.calls.requestBytes(fetch.call.handle).?,
        &decode_scratch,
    );
    try std.testing.expectEqualSlices(u16, &.{0}, request.find_node.distances);
    const raw = [_][]const u8{newer_record.slice()};
    const nodes = message.Message{ .nodes = .{ .request_id = nodes_id, .total = 1, .enrs = &raw } };
    try respond(&core, &controller, &newer_record, &nodes, 12, 21);
    try std.testing.expectEqual(@as(u64, 2), core.peerRecord(&peer.node_id).?.record.sequence);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

fn observeResponse(
    core: *Engine,
    controller: *Maintenance,
    remote_record: *const enr.Record,
    response: *const message.Message,
    now_ms: u64,
    entropy_seed: u8,
) !bool {
    const remote_key = try test_support.keyPair(2);
    var remote: Engine = undefined;
    try remote.init(
        std.testing.allocator,
        remote_key,
        remote_record.*,
        test_support.engineConfig(),
    );
    defer remote.deinit(std.testing.allocator);
    const local_peer = test_support.endpoint(core.localRecord());
    test_support.installSession(&remote, local_peer, 0x55);
    var packet: [1_280]u8 = undefined;
    const length = try remote.sendResponse(
        &packet,
        local_peer,
        response,
        now_ms,
        &sealEntropy(entropy_seed),
    );
    var out: [1_280]u8 = undefined;
    var scratch: Engine.Scratch = .{};
    const outcome = try core.receive(
        &out,
        packet[0..length],
        remote_record.endpoint().?,
        test_support.receiveArgs(now_ms, entropy_seed),
        &scratch,
    );
    try std.testing.expect(outcome == .accepted);
    const consumed = controller.onEvent(core, &outcome.accepted.event, now_ms);
    if (consumed.consumed and outcome.accepted.event.response.matched.terminal) {
        try std.testing.expectEqual(remote_record.node_id, consumed.responder.?.node_id);
    } else try std.testing.expect(consumed.responder == null);
    return consumed.consumed;
}

test "maintenance ENR refresh rejects an advertised endpoint that did not authenticate" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const old_record = try record(2, 1);
    const peer = test_support.endpoint(&old_record);
    const remote_key = try test_support.keyPair(2);
    const moved_record = try enr.Record.create(
        &remote_key,
        2,
        test_support.address4(198, 1, 2, 3, 9_999),
    );
    _ = try core.confirmPeer(&peer, &old_record, 0);
    test_support.installSession(&core, peer, 0x55);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const ping_id = try message.RequestId.init(&.{1});
    _ = (try controller.startNext(&core, &out, ping_id, 10, &sealEntropy(1))).?;
    const pong = message.Message{ .pong = .{
        .request_id = ping_id,
        .enr_sequence = 2,
        .recipient_ip = .{ .ip4 = .{ 203, 1, 1, 1 } },
        .recipient_port = 9_001,
    } };
    try respond(&core, &controller, &old_record, &pong, 11, 20);
    const nodes_id = try message.RequestId.init(&.{2});
    _ = (try controller.startNext(&core, &out, nodes_id, 11, &sealEntropy(2))).?;
    const raw = [_][]const u8{moved_record.slice()};
    const nodes = message.Message{ .nodes = .{ .request_id = nodes_id, .total = 1, .enrs = &raw } };
    try respond(&core, &controller, &old_record, &nodes, 12, 21);
    const retained = core.peerRecord(&peer.node_id).?;
    try std.testing.expectEqual(@as(u64, 1), retained.record.sequence);
    try std.testing.expectEqual(peer, retained.peer);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "maintenance configuration and cancellation stay bounded" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const remote = try record(2, 1);
    const peer = test_support.endpoint(&remote);
    _ = try core.confirmPeer(&peer, &remote, 0);
    var controller: Maintenance = undefined;
    var config = testConfig();
    config.retry_interval_ms = 0;
    try std.testing.expectError(error.InvalidConfig, controller.init(0, config, .dual));
    try controller.init(0, testConfig(), .dual);
    var out: [1280]u8 = undefined;
    _ = (try start(&controller, &core, &out, 1, 10)).?;
    try std.testing.expect((try start(&controller, &core, &out, 2, 11)) == null);
    try std.testing.expectEqual(@as(usize, 1), core.calls.count());
    controller.cancel(&core);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
    try std.testing.expect(controller.nextDeadlineMs(&core) == null);
    try std.testing.expect((try start(&controller, &core, &out, 3, 12)) == null);
    try controller.init(std.math.maxInt(u64), testConfig(), .dual);
    try std.testing.expectEqual(@as(?u64, std.math.maxInt(u64)), controller.nextDeadlineMs(&core));
}

test "maintenance preserves unrelated events and does not monopolize a busy peer" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const first_record = try record(2, 1);
    const second_record = try record(3, 1);
    const first_peer = test_support.endpoint(&first_record);
    const second_peer = test_support.endpoint(&second_record);
    _ = try core.confirmPeer(&first_peer, &first_record, 0);
    _ = try core.confirmPeer(&second_peer, &second_record, 0);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{99}),
        .enr_sequence = 1,
    } };
    var cursor: usize = 0;
    const target = core.maintenanceTarget(&cursor, 10, 10).?;
    const unrelated = try core.startCall(
        &out,
        target.peer,
        &target.record,
        &request,
        1,
        &sealEntropy(99),
    );
    try std.testing.expect((try start(&controller, &core, &out, 1, 10)) == null);
    const started = (try start(&controller, &core, &out, 2, 20)).?;
    try std.testing.expect(!std.mem.eql(u8, &target.peer.node_id, &started.peer.node_id));
    const unrelated_event = Engine.Event{ .failed = .{
        .handle = unrelated.handle,
        .peer = target.peer,
        .reason = error.SessionRequired,
    } };
    try std.testing.expect(!controller.onEvent(&core, &unrelated_event, 21).consumed);
    try std.testing.expect(core.cancelCall(unrelated.handle));
    const owned_event = Engine.Event{ .failed = .{
        .handle = started.call.handle,
        .peer = started.peer,
        .reason = error.SessionRequired,
    } };
    try std.testing.expect(controller.onEvent(&core, &owned_event, 21).consumed);
    try std.testing.expectEqual(@as(usize, 2), core.peerCount());
}

test "maintenance backs off on shared call capacity without dropping a live operation" {
    const key = try test_support.keyPair(1);
    var core: Engine = undefined;
    var config = test_support.engineConfig();
    config.call_capacity = 1;
    try core.init(std.testing.allocator, key, try record(1, 1), config);
    defer core.deinit(std.testing.allocator);
    for (2..4) |seed| {
        const remote = try record(@intCast(seed), 1);
        _ = try core.confirmPeer(&test_support.endpoint(&remote), &remote, 0);
    }
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    const remote = try record(4, 1);
    const request = message.Message{ .ping = .{ .request_id = try message.RequestId.init(&.{99}), .enr_sequence = 1 } };
    var out: [1280]u8 = undefined;
    const occupied = try core.startCall(&out, test_support.endpoint(&remote), &remote, &request, 0, &sealEntropy(99));
    try std.testing.expect((try start(&controller, &core, &out, 1, 10)) == null);
    try std.testing.expectEqual(@as(?u64, 15), controller.nextDeadlineMs(&core));
    try std.testing.expect(core.calls.endpoint(occupied.handle) != null);
    try std.testing.expect(core.cancelCall(occupied.handle));
    const active = (try start(&controller, &core, &out, 2, 15)).?;
    try std.testing.expectEqual(@as(usize, 1), core.calls.count());
    try std.testing.expect((try start(&controller, &core, &out, 3, 16)) == null);
    try std.testing.expect(controller.onFailure(&core, active.call.handle, 17, .local));
}

fn start(
    controller: *Maintenance,
    core: *Engine,
    out: []u8,
    id: u8,
    now_ms: u64,
) !?Engine.OutboundCall {
    return controller.startNext(
        core,
        out,
        try message.RequestId.init(&.{id}),
        now_ms,
        &sealEntropy(id),
    );
}

fn respond(
    core: *Engine,
    controller: *Maintenance,
    remote_record: *const enr.Record,
    response: *const message.Message,
    now_ms: u64,
    entropy_seed: u8,
) !void {
    try std.testing.expect(try observeResponse(
        core,
        controller,
        remote_record,
        response,
        now_ms,
        entropy_seed,
    ));
}

test "maintenance observes unrelated authenticated PONG without consuming the caller event" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const original = try record(2, 1);
    const updated = try record(2, 2);
    const peer = test_support.endpoint(&original);
    _ = try core.confirmPeer(&peer, &original, 0);
    test_support.installSession(&core, peer, 0x55);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const request_id = try message.RequestId.init(&.{1});
    const request = message.Message{ .ping = .{
        .request_id = request_id,
        .enr_sequence = 1,
    } };
    _ = try core.startCall(&out, peer, &original, &request, 0, &sealEntropy(1));
    const pong = message.Message{ .pong = .{
        .request_id = request_id,
        .enr_sequence = 2,
        .recipient_ip = .{ .ip4 = .{ 203, 1, 1, 1 } },
        .recipient_port = 9_001,
    } };
    try std.testing.expect(!try observeResponse(&core, &controller, &original, &pong, 1, 20));
    try std.testing.expectEqual(@as(?u64, 1), controller.nextDeadlineMs(&core));
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
    const fetch = (try start(&controller, &core, &out, 2, 1)).?;
    var scratch: message.DecodeScratch = .{};
    const fetch_request = try message.Message.decode(
        core.calls.requestBytes(fetch.call.handle).?,
        &scratch,
    );
    try std.testing.expectEqualSlices(u16, &.{0}, fetch_request.find_node.distances);
    const raw = [_][]const u8{updated.slice()};
    const nodes = message.Message{ .nodes = .{
        .request_id = try message.RequestId.init(&.{2}),
        .total = 1,
        .enrs = &raw,
    } };
    try respond(&core, &controller, &original, &nodes, 2, 21);
    try std.testing.expectEqual(@as(u64, 2), core.peerRecord(&peer.node_id).?.record.sequence);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "maintenance PONG hints preserve occupied and cancelled controller state" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const remote = try record(2, 1);
    const bootstrap = try record(3, 1);
    const peer = test_support.endpoint(&remote);
    test_support.installSession(&core, peer, 0x55);
    var controller: Maintenance = undefined;
    _ = try core.confirmPeer(&test_support.endpoint(&bootstrap), &bootstrap, 0);
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    _ = (try start(&controller, &core, &out, 1, 10)).?;
    _ = try core.confirmPeer(&peer, &remote, 0);
    const occupied = controller.pending.?.entry.peer;
    for (2..4) |id_number| {
        const id: u8 = @intCast(id_number);
        const request_id = try message.RequestId.init(&.{id});
        const request = message.Message{ .ping = .{
            .request_id = request_id,
            .enr_sequence = 1,
        } };
        _ = try core.startCall(&out, peer, &remote, &request, 10 + id, &sealEntropy(id));
        const pong = message.Message{ .pong = .{
            .request_id = request_id,
            .enr_sequence = 2,
            .recipient_ip = .{ .ip4 = .{ 203, 1, 1, 1 } },
            .recipient_port = 9_001,
        } };
        try std.testing.expect(!try observeResponse(
            &core,
            &controller,
            &remote,
            &pong,
            11 + id,
            id + 20,
        ));
        if (id == 2) {
            try std.testing.expectEqual(occupied, controller.pending.?.entry.peer);
            controller.cancel(&core);
        } else {
            try std.testing.expect(controller.pending == null);
            try std.testing.expect(controller.nextDeadlineMs(&core) == null);
        }
    }
}

test "maintenance ignores unrelated PONG hints from an unconfirmed endpoint" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const original = try record(2, 1);
    const original_peer = test_support.endpoint(&original);
    const key = try test_support.keyPair(2);
    const moved = try enr.Record.create(&key, 2, test_support.address4(198, 1, 2, 3, 9_999));
    const moved_peer = test_support.endpoint(&moved);
    _ = try core.confirmPeer(&original_peer, &original, 0);
    test_support.installSession(&core, moved_peer, 0x55);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const request_id = try message.RequestId.init(&.{1});
    const request = message.Message{ .ping = .{
        .request_id = request_id,
        .enr_sequence = 1,
    } };
    _ = try core.startCall(&out, moved_peer, &moved, &request, 0, &sealEntropy(1));
    const pong = message.Message{ .pong = .{
        .request_id = request_id,
        .enr_sequence = 2,
        .recipient_ip = .{ .ip4 = .{ 203, 1, 1, 1 } },
        .recipient_port = 9_001,
    } };
    try std.testing.expect(!try observeResponse(&core, &controller, &moved, &pong, 1, 20));
    try std.testing.expectEqual(@as(?u64, 10), controller.nextDeadlineMs(&core));
    try std.testing.expect(controller.pending == null);
    try std.testing.expectEqual(original_peer, core.peerRecord(&original.node_id).?.peer);
}

test "maintenance abandons an unstarted probe that becomes busy after capacity backoff" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    var out: [1_280]u8 = undefined;
    var occupied: [4]CallTable.Handle = undefined;
    for (&occupied, 4..) |*handle, seed_number| {
        const seed: u8 = @intCast(seed_number);
        const remote = try record(seed, 1);
        const request = message.Message{ .ping = .{
            .request_id = try message.RequestId.init(&.{seed}),
            .enr_sequence = 1,
        } };
        const call = try core.startCall(
            &out,
            test_support.endpoint(&remote),
            &remote,
            &request,
            0,
            &sealEntropy(seed),
        );
        handle.* = call.handle;
    }
    const seeds = [_]enr.Record{ try record(2, 1), try record(3, 1) };
    var controller: Maintenance = undefined;
    for (&seeds) |*seed| _ = try core.confirmPeer(&test_support.endpoint(seed), seed, 0);
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var cursor: usize = 0;
    const first = core.maintenanceTarget(&cursor, 10, 10).?;
    try std.testing.expect((try start(&controller, &core, &out, 1, 10)) == null);
    try std.testing.expectEqual(first.peer.node_id, controller.pending.?.entry.peer.node_id);
    try std.testing.expect(controller.pending.?.handle == null);
    for (occupied) |handle| try std.testing.expect(core.cancelCall(handle));
    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{99}),
        .enr_sequence = 1,
    } };
    const caller = try core.startCall(
        &out,
        first.peer,
        &first.record,
        &request,
        11,
        &sealEntropy(99),
    );
    defer _ = core.cancelCall(caller.handle);
    const next = try start(&controller, &core, &out, 2, 15);
    try std.testing.expect(next != null);
    try std.testing.expect(!std.mem.eql(u8, &first.peer.node_id, &next.?.peer.node_id));
    try std.testing.expect(core.isPeerBusy(&first.peer.node_id));
    try std.testing.expectEqual(@as(usize, 2), core.calls.count());
}

test "maintenance drops an unstarted ENR hint when a caller reuses the peer" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const remote = try record(2, 1);
    const peer = test_support.endpoint(&remote);
    _ = try core.confirmPeer(&peer, &remote, 0);
    test_support.installSession(&core, peer, 0x55);
    var controller: Maintenance = undefined;
    try controller.init(0, testConfig(), .dual);
    defer controller.cancel(&core);
    var out: [1_280]u8 = undefined;
    const request_id = try message.RequestId.init(&.{1});
    var request = message.Message{ .ping = .{
        .request_id = request_id,
        .enr_sequence = 1,
    } };
    _ = try core.startCall(&out, peer, &remote, &request, 0, &sealEntropy(1));
    const pong = message.Message{ .pong = .{
        .request_id = request_id,
        .enr_sequence = 2,
        .recipient_ip = .{ .ip4 = .{ 203, 1, 1, 1 } },
        .recipient_port = 9_001,
    } };
    try std.testing.expect(!try observeResponse(&core, &controller, &remote, &pong, 1, 20));
    try std.testing.expect(controller.pending.?.kind == .enr);
    request.ping.request_id = try message.RequestId.init(&.{99});
    const caller = try core.startCall(&out, peer, &remote, &request, 1, &sealEntropy(99));
    defer _ = core.cancelCall(caller.handle);
    try std.testing.expect((try start(&controller, &core, &out, 2, 1)) == null);
    try std.testing.expect(controller.pending == null);
    try std.testing.expect(core.isPeerBusy(&peer.node_id));
    try std.testing.expectEqual(@as(usize, 1), core.calls.count());
}

test "observation probes bypass fresh liveness, alternate families, and never punish a healthy endpoint" {
    const Votes = @import("AddressVotes.zig");
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const key = try test_support.keyPair(2);
    const public_key = crypto.compressedPublicKey(&key);
    const ip4 = [_]u8{ 203, 2, 1, 1 };
    const ip6 = [_]u8{ 0x20, 1, 0xd, 0xb8 } ++ .{0} ** 11 ++ .{1};
    const remote = try enr.Record.createFields(&key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &ip4 } },
        .{ .key = "ip6", .value = .{ .bytes = &ip6 } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "udp", .value = .{ .uint = 9000 } },
        .{ .key = "udp6", .value = .{ .uint = 9001 } },
    });
    const primary = test_support.endpoint(&remote);
    _ = try core.confirmPeer(&primary, &remote, 0);
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{ .enabled = true } });
    var controller: Maintenance = undefined;
    try controller.init(0, .{}, .dual);
    controller.observations = &votes;
    defer controller.cancel(&core);
    var out: [1280]u8 = undefined;
    const first = (try start(&controller, &core, &out, 1, 1000)).?;
    try std.testing.expect(first.peer.address == .ip4);
    try std.testing.expect(controller.onFailure(&core, first.call.handle, 1001, .expired));
    _ = try core.confirmPeer(&primary, &remote, 1002);
    try std.testing.expect((try start(&controller, &core, &out, 2, 1999)) == null);
    const second = (try start(&controller, &core, &out, 2, 2001)).?;
    try std.testing.expect(second.peer.address == .ip6);
    try std.testing.expectEqual(@as(u16, 9001), second.peer.address.port());
    try std.testing.expect(controller.onFailure(&core, second.call.handle, 2100, .expired));
    try std.testing.expectEqual(@as(?u64, 1002), core.peerRecord(&primary.node_id).?.last_verified_ms);
    try std.testing.expectEqual(primary, core.peerRecord(&primary.node_id).?.peer);
    try std.testing.expect((try start(&controller, &core, &out, 3, 4000)) == null);
    _ = try core.confirmPeer(&primary, &remote, Votes.lifetime_ms);
    const refreshed = (try start(&controller, &core, &out, 4, Votes.lifetime_ms + 1000)).?;
    try std.testing.expect(refreshed.peer.address == .ip4);
    try std.testing.expect(controller.onFailure(&core, refreshed.call.handle, Votes.lifetime_ms + 1001, .local));
    try std.testing.expect(votes.canProbe(&primary, Votes.lifetime_ms + 1001));
}

test "observation family rotation survives intervening routing probes" {
    const Votes = @import("AddressVotes.zig");
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const ip6 = [_]u8{ 0x20, 1, 0xd, 0xb8 } ++ .{0} ** 11 ++ .{1};
    const key = try test_support.keyPair(2);
    const public_key = crypto.compressedPublicKey(&key);
    const remote = try enr.Record.createFields(&key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &.{ 203, 2, 1, 1 } } },
        .{ .key = "ip6", .value = .{ .bytes = &ip6 } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "udp", .value = .{ .uint = 9000 } },
    });
    _ = try core.confirmPeer(&test_support.endpoint(&remote), &remote, 1000);
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{ .enabled = true } });
    var controller: Maintenance = undefined;
    try controller.init(0, .{ .stale_after_ms = 1, .probe_interval_ms = 1, .retry_interval_ms = 1 }, .dual);
    controller.observations = &votes;
    defer controller.cancel(&core);
    var out: [1280]u8 = undefined;
    const first = (try start(&controller, &core, &out, 1, 1000)).?;
    try std.testing.expect(first.peer.address == .ip4);
    try std.testing.expect(controller.onFailure(&core, first.call.handle, 1001, .local));
    for (0..3) |i| {
        const now: u64 = 1100 + 100 * i;
        const routing = (try start(&controller, &core, &out, @intCast(2 + i), now)).?;
        try std.testing.expect(routing.peer.address == .ip4);
        try std.testing.expect(controller.onFailure(&core, routing.call.handle, now + 1, .local));
    }
    const ipv6 = (try start(&controller, &core, &out, 5, 2000)).?;
    try std.testing.expect(ipv6.peer.address == .ip6);
}

test "maintenance replaces an expired incumbent but preserves later authenticated liveness" {
    const Pair = @import("transport_test_support.zig").Pair;
    for ([_]bool{ false, true }) |authenticated_later| {
        var setup_io: test_support.ManualIo = .{};
        var pair: Pair = undefined;
        try pair.init(setup_io.io(), 1, true);
        defer pair.deinit();
        try pair.fillBucket();
        var controller: Maintenance = undefined;
        try controller.init(0, .{}, .ip4);
        defer controller.cancel(&pair.transport_a.engine);
        var out: [1_280]u8 = undefined;
        const started = (try controller.startNext(&pair.transport_a.engine, &out, try .init(&.{1}), 0, &test_support.sealEntropy(10))).?;
        if (authenticated_later) _ = try pair.transport_a.engine.confirmPeer(&started.peer, &pair.record_b, std.math.maxInt(u64));
        var expired: [4]CallTable.Expired = undefined;
        const result = pair.transport_a.engine.expire(1, &expired);
        try std.testing.expectEqual(@as(usize, 1), result.calls);
        try std.testing.expect(controller.onFailure(&pair.transport_a.engine, expired[0].handle, 1, .expired));
        if (!authenticated_later) {
            try std.testing.expectEqual(@as(usize, 1), pair.transport_a.engine.routing.pendingCount());
            const retry_ms = controller.next_start_ms.?;
            const retried = (try controller.startNext(&pair.transport_a.engine, &out, try .init(&.{2}), retry_ms, &test_support.sealEntropy(11))).?;
            try std.testing.expect(started.peer.eql(&retried.peer));
            const retried_expiry = pair.transport_a.engine.expire(retry_ms + 1, &expired);
            try std.testing.expectEqual(@as(usize, 1), retried_expiry.calls);
            try std.testing.expect(controller.onFailure(&pair.transport_a.engine, expired[0].handle, retry_ms + 1, .expired));
        }
        try std.testing.expectEqual(@as(usize, 0), pair.transport_a.engine.routing.pendingCount());
        try std.testing.expectEqual(authenticated_later, pair.transport_a.engine.routing.contains(&pair.record_b.node_id));
        try std.testing.expectEqual(!authenticated_later, pair.transport_a.engine.routing.contains(&pair.candidate_id));
        try std.testing.expectEqual(@as(usize, 0), pair.transport_a.engine.calls.count());
    }
}
