const std = @import("std");
const address_policy = @import("address_policy.zig");
const Engine = @import("Engine.zig");
const crypto = @import("identity/crypto.zig");
const enr = @import("identity/enr.zig");
const Lookup = @import("Lookup.zig");
const message = @import("wire/message.zig");
const RoutingTable = @import("RoutingTable.zig");
const SessionStore = @import("SessionStore.zig");
const test_support = @import("test_support.zig");
const types = @import("types.zig");

const address4 = test_support.address4;
const fakeRecord = test_support.fakeRecord;
const installSession = test_support.installSession;
const keyPair = test_support.keyPair;
const sealEntropy = test_support.sealEntropy;

test "lookup requests the target distance and adjacent buckets" {
    const zero = [_]u8{0} ** 32;
    var distance_255 = zero;
    distance_255[0] = 0x40;
    try std.testing.expectEqualSlices(
        u16,
        &.{ 255, 256, 254 },
        &Lookup.requestDistances(&zero, &distance_255),
    );
    try std.testing.expectEqualSlices(
        u16,
        &.{ 0, 1, 2 },
        &Lookup.requestDistances(&zero, &zero),
    );
    var distance_256 = zero;
    distance_256[0] = 0x80;
    try std.testing.expectEqualSlices(
        u16,
        &.{ 256, 255, 254 },
        &Lookup.requestDistances(&zero, &distance_256),
    );
}

test "lookup uses the call table for bounded parallel queries" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    var seeds: [4]RoutingTable.Entry = undefined;
    for (&seeds, 0..) |*seed, index| {
        seed.* = fakeEntry(@intCast(index + 1));
        installSession(&core, seed.peer, 0x55);
    }
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, core.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);

    var packet_buffer: [1_280]u8 = undefined;
    var started: [4]Engine.OutboundCall = undefined;
    for (0..3) |index| {
        started[index] = (try operation.startNext(
            &core,
            &packet_buffer,
            try message.RequestId.init(&.{@intCast(index + 1)}),
            1,
            &sealEntropy(@intCast(index + 1)),
        )).?;
        try std.testing.expectEqualDeep(seeds[index].peer, started[index].peer);
    }
    try std.testing.expectEqual(Lookup.parallelism, operation.waitingCount());
    try std.testing.expect((try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{9}),
        1,
        &sealEntropy(9),
    )) == null);

    try std.testing.expect(operation.onFailure(&core, started[0].call.handle));
    started[3] = (try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{4}),
        2,
        &sealEntropy(4),
    )).?;
    try std.testing.expectEqual(Lookup.parallelism, operation.waitingCount());
    for (1..4) |index| try completeNodes(
        &core,
        &operation,
        started[index],
        try message.RequestId.init(&.{@intCast(index + 1)}),
        &.{},
        3 + index,
    );
    try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
    try std.testing.expect((try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{10}),
        10,
        &sealEntropy(10),
    )) == null);
    try std.testing.expect(operation.isFinished());
    try std.testing.expectEqual(Lookup.FinishReason.exhausted, operation.finishReason().?);
    try std.testing.expectEqual(@as(u16, 4), operation.statistics().queries_started);
    try std.testing.expectEqual(@as(u32, 0), operation.statistics().capacity_drops);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "lookup skips the busy closest peer and retries it after release" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const seeds = [_]RoutingTable.Entry{ fakeEntry(1), fakeEntry(2), fakeEntry(3) };
    for (&seeds) |*seed| installSession(&core, seed.peer, 0x55);
    var packet_buffer: [1_280]u8 = undefined;
    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{1}),
        .enr_sequence = 1,
    } };
    const unrelated = try core.startCall(
        &packet_buffer,
        seeds[0].peer,
        &seeds[0].record,
        &request,
        1,
        &sealEntropy(1),
    );
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, core.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);
    defer operation.cancel(&core);

    for (2..4) |id| {
        const started = (try operation.startNext(
            &core,
            &packet_buffer,
            try message.RequestId.init(&.{@intCast(id)}),
            2,
            &sealEntropy(@intCast(id)),
        )).?;
        try std.testing.expectEqual(nodeId(@intCast(id)), started.peer.node_id);
        try std.testing.expect(operation.onFailure(&core, started.call.handle));
    }
    try std.testing.expect((try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{4}),
        3,
        &sealEntropy(4),
    )) == null);
    try std.testing.expect(!operation.isFinished());
    try std.testing.expect(core.cancelCall(unrelated.handle));
    const retried = (try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{5}),
        4,
        &sealEntropy(5),
    )).?;
    try std.testing.expectEqual(nodeId(1), retried.peer.node_id);
    try std.testing.expectEqual(@as(usize, 1), core.calls.count());
}

test "lookup rejects relayed private and low-port candidates" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const seed = fakeEntry(1);
    installSession(&core, seed.peer, 0x55);
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, core.localRecord().node_id, [_]u8{0} ** 32, &.{seed}, .dual);

    var packet_buffer: [1_280]u8 = undefined;
    const request_id = try message.RequestId.init(&.{1});
    const started = (try operation.startNext(
        &core,
        &packet_buffer,
        request_id,
        1,
        &sealEntropy(1),
    )).?;
    var records = [_]enr.Record{
        fakeRecord(nodeId(20), address4(198, 51, 100, 20, 9_020), 1),
        fakeRecord(nodeId(21), address4(10, 0, 0, 21, 9_021), 1),
        fakeRecord(nodeId(22), address4(198, 51, 100, 22, 80), 1),
    };
    try completeNodes(
        &core,
        &operation,
        started,
        request_id,
        &records,
        2,
    );
    try std.testing.expectEqual(@as(usize, 2), operation.candidateCount());

    const next = (try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{2}),
        3,
        &sealEntropy(2),
    )).?;
    try std.testing.expectEqual(nodeId(20), next.peer.node_id);
    operation.cancel(&core);
    try std.testing.expectEqual(Lookup.FinishReason.cancelled, operation.finishReason().?);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "lookup stops after the closest sixteen successful peers" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    var seeds: [Lookup.result_max]RoutingTable.Entry = undefined;
    for (&seeds, 0..) |*seed, index| {
        seed.* = fakeEntry(@intCast(index + 1));
        installSession(&core, seed.peer, 0x55);
    }
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, core.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);

    var packet_buffer: [1_280]u8 = undefined;
    var farther_id = [_]u8{0xff} ** 32;
    farther_id[31] = 1;
    const farther = fakeRecord(farther_id, address4(198, 51, 100, 40, 9_040), 1);
    for (0..Lookup.result_max) |index| {
        const request_id = try message.RequestId.init(&.{@intCast(index + 1)});
        const started = (try operation.startNext(
            &core,
            &packet_buffer,
            request_id,
            @intCast(index + 1),
            &sealEntropy(@intCast(index + 1)),
        )).?;
        try std.testing.expectEqualDeep(seeds[index].peer, started.peer);
        const records: []const enr.Record = if (index == 0) &.{farther} else &.{};
        try completeNodes(
            &core,
            &operation,
            started,
            request_id,
            records,
            @intCast(index + 2),
        );
    }
    try std.testing.expectEqual(Lookup.result_max + 1, operation.candidateCount());
    try std.testing.expect((try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{20}),
        20,
        &sealEntropy(20),
    )) == null);
    try std.testing.expect(operation.isFinished());
    try std.testing.expectEqual(Lookup.FinishReason.converged, operation.finishReason().?);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

fn matchesNode(context: *const anyopaque, record: *const enr.Record) bool {
    const wanted: *const types.NodeId = @ptrCast(@alignCast(context));
    return std.mem.eql(u8, wanted, &record.node_id);
}

test "filtered lookup continues past sixteen unrelated successes and prioritizes matching records" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    var seeds: [Lookup.result_max]RoutingTable.Entry = undefined;
    for (&seeds, 0..) |*seed, index| {
        seed.* = fakeEntry(@intCast(index + 1));
        installSession(&core, seed.peer, 0x55);
    }
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, core.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);
    defer operation.cancel(&core);
    const wanted = nodeId(40);
    operation.filter = .{ .context = &wanted, .matches = matchesNode };
    var packet: [1280]u8 = undefined;
    for (0..Lookup.result_max) |i| {
        const id = try message.RequestId.init(&.{@intCast(i + 1)});
        const started = (try operation.startNext(&core, &packet, id, i + 1, &sealEntropy(@intCast(i + 1)))).?;
        const records: []const enr.Record = if (i == Lookup.result_max - 1)
            &.{ fakeEntry(20).record, fakeEntry(40).record }
        else
            &.{};
        try completeNodes(&core, &operation, started, id, records, i + 2);
    }
    const id = try message.RequestId.init(&.{40});
    installSession(&core, fakeEntry(40).peer, 0x55);
    const matching = (try operation.startNext(&core, &packet, id, 40, &sealEntropy(40))).?;
    try std.testing.expectEqual(wanted, matching.peer.node_id);
    try completeNodes(&core, &operation, matching, id, &.{}, 41);
    try std.testing.expectEqual(@as(u16, 17), operation.statistics().queries_started);
    try std.testing.expect(!operation.isFinished());
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "filtered lookup stops at its query budget after retiring pending calls" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const seeds = [_]RoutingTable.Entry{ fakeEntry(1), fakeEntry(2), fakeEntry(3), fakeEntry(4) };
    for (&seeds) |*seed| installSession(&core, seed.peer, 0x55);
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, core.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);
    defer operation.cancel(&core);
    const wanted = nodeId(40);
    operation.filter = .{ .context = &wanted, .matches = matchesNode };
    operation.query_limit = 2;
    var packet: [1280]u8 = undefined;
    var pending: [2]Engine.OutboundCall = undefined;
    for (&pending, 1..) |*started, i| started.* = (try operation.startNext(&core, &packet, try message.RequestId.init(&.{@intCast(i)}), 1, &sealEntropy(@intCast(i)))).?;
    try std.testing.expect((try operation.startNext(&core, &packet, try message.RequestId.init(&.{3}), 2, &sealEntropy(3))) == null);
    try std.testing.expect(!operation.isFinished());
    for (pending) |started| try std.testing.expect(operation.onFailure(&core, started.call.handle));
    try std.testing.expect((try operation.startNext(&core, &packet, try message.RequestId.init(&.{4}), 3, &sealEntropy(4))) == null);
    try std.testing.expectEqual(Lookup.FinishReason.budget_exhausted, operation.finishReason().?);
    try std.testing.expectEqual(@as(u16, 2), operation.statistics().queries_started);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "lookup initialization cleans up after an invalid seed" {
    var seed = fakeEntry(1);
    seed.record.node_id = nodeId(2);
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try std.testing.expectError(error.InvalidSeed, operation.init(&operation_candidates, [_]u8{0} ** 32, [_]u8{0xff} ** 32, &.{seed}, .dual));
}

test "empty lookup finishes without creating a call" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, core.localRecord().node_id, [_]u8{0} ** 32, &.{}, .dual);
    var packet_buffer: [1_280]u8 = undefined;
    try std.testing.expect((try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{1}),
        1,
        &sealEntropy(1),
    )) == null);
    try std.testing.expect(operation.isFinished());
    try std.testing.expectEqual(Lookup.FinishReason.exhausted, operation.finishReason().?);
    try std.testing.expectEqual(@as(u16, 0), operation.statistics().queries_started);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "lookup reports candidate budget exhaustion after dropping a closer peer" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    const seed = budgetEntry(272);
    try operation.init(&candidates, core.localRecord().node_id, [_]u8{0} ** 32, &.{seed}, .dual);
    var packet_buffer: [1_280]u8 = undefined;

    for (0..272) |index| {
        const current = budgetEntry(@intCast(272 - index));
        installSession(&core, current.peer, 0x55);
        const request_id = try message.RequestId.init(&.{ @intCast(index >> 8), @truncate(index) });
        const started = (try operation.startNext(
            &core,
            &packet_buffer,
            request_id,
            index * 2,
            &sealEntropy(@truncate(index)),
        )).?;
        try std.testing.expectEqual(current.peer.node_id, started.peer.node_id);
        const next = budgetEntry(@intCast(271 - index));
        try completeNodes(
            &core,
            &operation,
            started,
            request_id,
            &.{ next.record, seed.record },
            index * 2 + 1,
        );
    }
    try std.testing.expect((try operation.startNext(
        &core,
        &packet_buffer,
        try message.RequestId.init(&.{0xff}),
        600,
        &sealEntropy(1),
    )) == null);
    try std.testing.expectEqual(@as(usize, 272), operation.candidateCount());
    try std.testing.expectEqual(@as(u16, 272), operation.statistics().queries_started);
    try std.testing.expectEqual(@as(u32, 1), operation.statistics().capacity_drops);
    try std.testing.expectEqual(Lookup.FinishReason.budget_exhausted, operation.finishReason().?);
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

fn budgetEntry(id: u16) RoutingTable.Entry {
    var entry = fakeEntry(1);
    std.mem.writeInt(u16, entry.peer.node_id[30..32], id, .big);
    entry.record.node_id = entry.peer.node_id;
    return entry;
}

fn initEngine() !Engine {
    const key = try keyPair(0x11);
    const local_record = try enr.Record.create(
        &key,
        1,
        address4(203, 0, 113, 1, 9_000),
    );
    var core: Engine = undefined;
    try core.init(std.testing.allocator, key, local_record, .{
        .session_capacity = 8,
        .challenge_capacity = 4,
        .call_capacity = 8,
        .request_timeout_ms = 100,
        .challenge_timeout_ms = 100,
        .session_idle_timeout_ms = 1_000,
    });
    return core;
}

fn completeNodes(
    core: *Engine,
    operation: *Lookup,
    started: Engine.OutboundCall,
    request_id: message.RequestId,
    records: []const enr.Record,
    now_ms: u64,
) !void {
    var node_ids: [Lookup.result_max]types.NodeId = undefined;
    for (records, node_ids[0..records.len]) |record, *node_id| node_id.* = record.node_id;
    const raw_records = [_][]const u8{};
    const response_message = message.Message{ .nodes = .{
        .request_id = request_id,
        .total = 1,
        .enrs = &raw_records,
    } };
    const handle = try core.calls.match(started.peer, &response_message, now_ms);
    var nonce = [_]u8{0} ** 12;
    std.mem.writeInt(u64, nonce[0..8], now_ms, .big);
    const matched = try core.calls.accept(handle, &response_message, node_ids[0..0], &nonce);
    const response = Engine.AuthenticatedResponse{
        .peer = started.peer,
        .matched = matched.matched,
        .record = null,
        .node_records = records,
    };
    const event = Engine.Event{ .response = response };
    const consumed = try operation.onEvent(core, &event, now_ms);
    try std.testing.expect(consumed.consumed);
    try std.testing.expectEqual(started.peer.node_id, consumed.responder.?.node_id);
}

fn fakeEntry(id: u8) RoutingTable.Entry {
    const peer = types.Endpoint{
        .node_id = nodeId(id),
        .address = address4(203, id, 1, 1, 9_000 + @as(u16, id)),
    };
    return .{
        .peer = peer,
        .record = fakeRecord(peer.node_id, peer.address, 1),
        .last_verified_ms = 0,
        .direction = .outgoing,
    };
}

fn nodeId(id: u8) types.NodeId {
    var node_id = [_]u8{0} ** 32;
    node_id[0] = 0x80;
    node_id[31] = id;
    return node_id;
}

test "lookup confirmed result retains global IPv6 provenance over private IPv4 record preference" {
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const key = try crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{2}));
    const public_key = crypto.compressedPublicKey(&key);
    const ip4: [4]u8 = .{ 10, 0, 0, 1 };
    const ip6: [16]u8 = .{ 0x26, 0x06, 0x47, 0x00 } ++ .{0} ** 11 ++ .{1};
    const record = try enr.Record.createFields(&key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &ip4 } },
        .{ .key = "ip6", .value = .{ .bytes = &ip6 } },
        .{ .key = "quic", .value = .{ .uint = 9001 } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "udp", .value = .{ .uint = 9000 } },
        .{ .key = "udp6", .value = .{ .uint = 9000 } },
    });
    const source = types.Endpoint{ .node_id = record.node_id, .address = .{ .ip6 = .{ .octets = ip6, .port = 9000 } } };
    const target = address4(10, 0, 0, 1, 9001);
    _ = try core.confirmPeer(&source, &record, 0);
    installSession(&core, source, 0x55);
    var candidates: Lookup.Candidates = undefined;
    var operation: Lookup = undefined;
    try operation.init(&candidates, core.localRecord().node_id, record.node_id, &.{core.peerRecord(&record.node_id).?}, .dual);
    defer operation.cancel(&core);
    var output: [1280]u8 = undefined;
    const request_id = try message.RequestId.init(&.{1});
    const started = (try operation.startNext(&core, &output, request_id, 1, &sealEntropy(1))).?;
    try std.testing.expectEqualDeep(source, started.peer);
    try completeNodes(&core, &operation, started, request_id, &.{}, 2);
    try std.testing.expect((try operation.startNext(&core, &output, try message.RequestId.init(&.{2}), 3, &sealEntropy(2))) == null);
    try std.testing.expect(operation.isFinished());
    const confirmed = core.peerRecord(&record.node_id).?;
    try std.testing.expectEqualDeep(source, confirmed.peer);
    try std.testing.expectEqualSlices(u8, record.slice(), confirmed.record.slice());
    try std.testing.expect(!address_policy.relayAllowed(confirmed.peer.address, target));
    try std.testing.expect(address_policy.relayAllowed(confirmed.record.endpoint().?, target));
    try std.testing.expectEqual(@as(usize, 0), core.calls.count());
}

test "lookup skips unreachable IPv6 candidates without consuming call capacity" {
    for ([_]bool{ false, true }) |enabled| {
        var core = try initEngine();
        defer core.deinit(std.testing.allocator);
        var seeds = [_]RoutingTable.Entry{ fakeEntry(1), fakeEntry(2) };
        seeds[0].peer.address = test_support.address6(.{ 0x20, 1 } ++ .{0} ** 13 ++ .{1}, 9000);
        seeds[0].record = fakeRecord(seeds[0].peer.node_id, seeds[0].peer.address, 1);
        for (seeds) |seed| installSession(&core, seed.peer, 0x55);
        var operation: Lookup = undefined;
        var candidates: Lookup.Candidates = undefined;
        try operation.init(&candidates, core.localRecord().node_id, [_]u8{0} ** 32, &seeds, if (enabled) .dual else .ip4);
        defer operation.cancel(&core);
        var packet: [1280]u8 = undefined;
        var count: usize = 0;
        for (0..3) |index| {
            const started = (try operation.startNext(&core, &packet, try message.RequestId.init(&.{@intCast(index + 1)}), 1, &sealEntropy(@intCast(index + 1)))) orelse break;
            if (!enabled) try std.testing.expect(started.peer.address == .ip4);
            count += 1;
            try std.testing.expect(operation.onFailure(&core, started.call.handle));
        }
        try std.testing.expectEqual(@as(usize, if (enabled) 2 else 1), count);
        try std.testing.expectEqual(@as(usize, 0), core.calls.count());
        try std.testing.expect(operation.isFinished());
    }
}

test "IPv6 lookup selects the reachable endpoint before importing dual-stack seeds" {
    var seed = fakeEntry(1);
    seed.record.ip6 = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{1};
    seed.record.udp6 = 9001;
    var candidates: Lookup.Candidates = undefined;
    var lookup: Lookup = undefined;
    try lookup.init(&candidates, @splat(0), @splat(1), &.{seed}, .ip6);
    try std.testing.expectEqual(@as(usize, 1), lookup.candidateCount());
    try std.testing.expectEqualDeep(seed.record.endpointFor(.ip6).?, candidates[0].peer.address);
}

test "dual lookup chooses a relay-eligible endpoint before rejecting a signed record" {
    const remote_key = try keyPair(9);
    const public_key = crypto.compressedPublicKey(&remote_key);
    const ip4: [4]u8 = .{ 10, 0, 0, 1 };
    const ip6: [16]u8 = .{ 0x26, 0x06, 0x47, 0 } ++ .{0} ** 11 ++ .{1};
    const remote = try enr.Record.createFields(&remote_key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &ip4 } },
        .{ .key = "ip6", .value = .{ .bytes = &ip6 } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "udp", .value = .{ .uint = 9000 } },
        .{ .key = "udp6", .value = .{ .uint = 9000 } },
    });
    for ([_]types.Mode{ .ip4, .ip6, .dual }) |mode| {
        var core = try initEngine();
        defer core.deinit(std.testing.allocator);
        var seed = fakeEntry(1);
        if (mode != .ip4) seed.peer.address = test_support.address6(ip6, 9001);
        seed.record = fakeRecord(seed.peer.node_id, seed.peer.address, 1);
        installSession(&core, seed.peer, 0x55);
        var candidates: Lookup.Candidates = undefined;
        var lookup: Lookup = undefined;
        try lookup.init(&candidates, core.localRecord().node_id, remote.node_id, &.{seed}, mode);
        defer lookup.cancel(&core);
        var output: [1280]u8 = undefined;
        const id = try message.RequestId.init(&.{1});
        const started = (try lookup.startNext(&core, &output, id, 1, &sealEntropy(1))).?;
        try completeNodes(&core, &lookup, started, id, &.{remote}, 2);
        try std.testing.expectEqual(@as(usize, if (mode == .ip4) 1 else 2), lookup.candidateCount());
        if (mode != .ip4) try std.testing.expectEqualDeep(remote.endpointFor(.ip6).?, candidates[1].peer.address);
    }
}

fn dualRecord(ip4: [4]u8, ip6: [16]u8, port6: u16) !enr.Record {
    const key = try keyPair(9);
    const public_key = crypto.compressedPublicKey(&key);
    return enr.Record.createFields(&key, 1, &.{
        .{ .key = "id", .value = .{ .bytes = "v4" } },
        .{ .key = "ip", .value = .{ .bytes = &ip4 } },
        .{ .key = "ip6", .value = .{ .bytes = &ip6 } },
        .{ .key = "secp256k1", .value = .{ .bytes = &public_key } },
        .{ .key = "udp", .value = .{ .uint = 9000 } },
        .{ .key = "udp6", .value = .{ .uint = port6 } },
    });
}

test "dual lookup retries the alternate signed seed endpoint and confirms its exact address" {
    const record = try dualRecord(.{ 203, 0, 113, 9 }, .{ 0x26, 6, 0x47, 0 } ++ .{0} ** 11 ++ .{9}, 9000);
    for ([_]types.Mode{ .ip4, .ip6 }) |first_family| {
        var core = try initEngine();
        defer core.deinit(std.testing.allocator);
        const seed: RoutingTable.Entry = .{
            .peer = .{ .node_id = record.node_id, .address = record.endpointFor(first_family).? },
            .record = record,
            .last_verified_ms = 0,
            .direction = .outgoing,
        };
        var candidates: Lookup.Candidates = undefined;
        var lookup: Lookup = undefined;
        try lookup.init(&candidates, core.localRecord().node_id, record.node_id, &.{seed}, .dual);
        defer lookup.cancel(&core);
        var out: [1280]u8 = undefined;
        const id = try message.RequestId.init(&.{1});
        const first = (try lookup.startNext(&core, &out, id, 1, &sealEntropy(1))).?;
        try std.testing.expectEqualDeep(seed.peer, first.peer);
        try std.testing.expect(lookup.onFailure(&core, first.call.handle));
        try std.testing.expectEqual(@as(usize, 0), core.calls.count());
        const second = (try lookup.startNext(&core, &out, id, 2, &sealEntropy(2))).?;
        try std.testing.expectEqual(record.node_id, second.peer.node_id);
        try std.testing.expectEqualDeep(record.endpointFor(if (first_family == .ip4) .ip6 else .ip4).?, second.peer.address);
        try std.testing.expectEqual(@as(usize, 1), lookup.candidateCount());
        try completeNodes(&core, &lookup, second, id, &.{}, 3);
        try std.testing.expect((try lookup.startNext(&core, &out, id, 4, &sealEntropy(3))) == null);
        try std.testing.expectEqualDeep(second.peer, core.peerRecord(&record.node_id).?.peer);
        try std.testing.expectEqual(@as(u16, 2), lookup.statistics().queries_started);
    }
}

test "discovered alternate retry preserves family relay port and total query limits" {
    const global6: [16]u8 = .{ 0x26, 6, 0x47, 0 } ++ .{0} ** 11 ++ .{9};
    const cases = [_]struct { mode: types.Mode = .dual, ip6: [16]u8 = global6, port6: u16 = 9000, budget: u16 = 3, retries: bool = false }{
        .{ .retries = true },
        .{ .mode = .ip4 },
        .{ .mode = .ip6 },
        .{ .ip6 = .{0xfd} ++ .{0} ** 15 },
        .{ .port6 = Lookup.discovered_port_min - 1 },
        .{ .budget = 2 },
    };
    for (cases) |case| {
        var core = try initEngine();
        defer core.deinit(std.testing.allocator);
        var seed = fakeEntry(1);
        if (case.mode == .ip6) {
            seed.peer.address = test_support.address6(global6, 9001);
            seed.record = fakeRecord(seed.peer.node_id, seed.peer.address, 1);
        }
        installSession(&core, seed.peer, 0x55);
        const record = try dualRecord(.{ 203, 0, 113, 9 }, case.ip6, case.port6);
        var candidates: Lookup.Candidates = undefined;
        var lookup: Lookup = undefined;
        try lookup.init(&candidates, core.localRecord().node_id, record.node_id, &.{seed}, case.mode);
        defer lookup.cancel(&core);
        lookup.query_limit = case.budget;
        var out: [1280]u8 = undefined;
        const id = try message.RequestId.init(&.{1});
        const referral = (try lookup.startNext(&core, &out, id, 1, &sealEntropy(1))).?;
        try completeNodes(&core, &lookup, referral, id, &.{ record, record }, 2);
        try std.testing.expectEqual(@as(usize, 2), lookup.candidateCount());
        const first = (try lookup.startNext(&core, &out, id, 3, &sealEntropy(2))).?;
        try std.testing.expectEqualDeep(record.endpointFor(if (case.mode == .ip6) .ip6 else .ip4).?, first.peer.address);
        try std.testing.expect(lookup.onFailure(&core, first.call.handle));
        const second = try lookup.startNext(&core, &out, id, 4, &sealEntropy(3));
        try std.testing.expectEqual(case.retries, second != null);
        if (second) |retry| {
            try std.testing.expectEqualDeep(record.endpointFor(.ip6).?, retry.peer.address);
            try std.testing.expect(lookup.onFailure(&core, retry.call.handle));
            try std.testing.expect((try lookup.startNext(&core, &out, id, 5, &sealEntropy(4))) == null);
        }
        try std.testing.expect(lookup.isFinished());
        try std.testing.expectEqual(@as(usize, 0), core.calls.count());
        try std.testing.expectEqual(@as(u16, if (case.retries) 3 else 2), lookup.statistics().queries_started);
    }
}

test "lookup evaluates each eligible filter once per selection and refreshes it next pass" {
    const Filter = struct {
        wanted: types.NodeId,
        calls: [4]u8 = @splat(0),

        fn matches(context: *const anyopaque, record: *const enr.Record) bool {
            const self: *@This() = @ptrCast(@alignCast(@constCast(context)));
            self.calls[record.node_id[31]] += 1;
            return std.mem.eql(u8, &self.wanted, &record.node_id);
        }
    };
    var core = try initEngine();
    defer core.deinit(std.testing.allocator);
    const seeds = [_]RoutingTable.Entry{ fakeEntry(1), fakeEntry(2), fakeEntry(3) };
    for (&seeds) |*seed| installSession(&core, seed.peer, 0x55);
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, core.localRecord().node_id, @splat(0), &seeds, .dual);
    defer operation.cancel(&core);
    var filter: Filter = .{ .wanted = nodeId(1) };
    operation.filter = .{ .context = &filter, .matches = Filter.matches };
    var out: [1280]u8 = undefined;
    const first = (try operation.startNext(&core, &out, try .init(&.{1}), 1, &sealEntropy(1))).?;
    try std.testing.expectEqual(nodeId(1), first.peer.node_id);
    try std.testing.expectEqual([4]u8{ 0, 1, 1, 1 }, filter.calls);
    filter.wanted = nodeId(3);
    filter.calls = @splat(0);
    const second = (try operation.startNext(&core, &out, try .init(&.{2}), 2, &sealEntropy(2))).?;
    try std.testing.expectEqual(nodeId(3), second.peer.node_id);
    try std.testing.expectEqual([4]u8{ 0, 0, 1, 1 }, filter.calls);
}

test "lookup ignores stale events and releases owned calls on failure" {
    for (std.enums.values(enum { failed, unexpected_response, wrong_peer })) |scenario| {
        var core = try initEngine();
        defer core.deinit(std.testing.allocator);
        const seed = fakeEntry(1);
        installSession(&core, seed.peer, 0x55);
        var operation: Lookup = undefined;
        var candidates: Lookup.Candidates = undefined;
        try operation.init(&candidates, core.localRecord().node_id, seed.peer.node_id, &.{seed}, .dual);
        defer operation.cancel(&core);
        var out: [1280]u8 = undefined;
        const id = try message.RequestId.init(&.{1});
        const started = (try operation.startNext(&core, &out, id, 1, &sealEntropy(1))).?;
        var stale = started.call.handle;
        stale.generation += 1;
        const unrelated = try operation.onEvent(&core, &.{ .failed = .{
            .handle = stale,
            .peer = seed.peer,
            .reason = error.SessionRequired,
        } }, 2);
        try std.testing.expect(!unrelated.consumed);
        try std.testing.expect(unrelated.responder == null);
        try std.testing.expectEqual(@as(usize, 1), operation.waitingCount());
        try std.testing.expectEqual(@as(usize, 1), core.calls.count());

        var event = Engine.Event{ .response = .{
            .peer = seed.peer,
            .matched = .{ .handle = started.call.handle, .response = .{ .nodes = .{ .request_id = id, .total = 1, .enrs = &.{} } }, .terminal = true },
            .record = null,
            .node_records = &.{},
        } };
        switch (scenario) {
            .failed => {
                event = .{ .failed = .{ .handle = started.call.handle, .peer = seed.peer, .reason = error.SessionRequired } };
                const consumed = try operation.onEvent(&core, &event, 2);
                try std.testing.expect(consumed.consumed);
                try std.testing.expect(consumed.responder == null);
            },
            .unexpected_response => {
                event.response.matched.response = .{ .talk_response = .{ .request_id = id, .response = &.{} } };
                try std.testing.expectError(error.UnexpectedResponse, operation.onEvent(&core, &event, 2));
            },
            .wrong_peer => {
                event.response.peer.address.ip4.port += 1;
                try std.testing.expectError(error.UnknownQuery, operation.onEvent(&core, &event, 2));
            },
        }
        try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
        try std.testing.expectEqual(@as(usize, 0), core.calls.count());
        try std.testing.expect(core.peerRecord(&seed.peer.node_id) == null);
        try std.testing.expect(!(try operation.onEvent(&core, &event, 3)).consumed);
        try std.testing.expect(!operation.onFailure(&core, started.call.handle));
    }
}
