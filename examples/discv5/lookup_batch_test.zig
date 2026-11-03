const std = @import("std");
const discv5 = @import("discv5");
const net = std.Io.net;
const CallTable = discv5.CallTable;
const Transport = discv5.Transport;
const Engine = discv5.Engine;
const Lookup = discv5.Lookup;
const RoutingTable = discv5.RoutingTable;
const Sockets = @import("udp").Sockets;
const enr = discv5.identity.enr;
const lookup_batch = @import("lookup_batch.zig");
const message = discv5.wire.message;
const packet = discv5.wire.packet;
const types = discv5.types;
const waitForDatagram = @import("socket_test_support").waitForDatagram;

test "lookup batch rotates priority under one-call contention" {
    var network: Network = undefined;
    try network.init(1);
    defer network.deinit();
    const seeds_a = [_]RoutingTable.Entry{ network.seed(1), network.seed(2) };
    const seeds_b = [_]RoutingTable.Entry{ network.seed(3), network.seed(4) };
    var a: Lookup = undefined;
    var b: Lookup = undefined;
    var candidates_a: Lookup.Candidates = undefined;
    var candidates_b: Lookup.Candidates = undefined;
    try a.init(&candidates_a, network.transport.engine.localRecord().node_id, [_]u8{0} ** 32, &seeds_a, .dual);
    defer a.cancel(&network.transport.engine);
    try b.init(&candidates_b, network.transport.engine.localRecord().node_id, [_]u8{0} ** 32, &seeds_b, .dual);
    defer b.cancel(&network.transport.engine);
    const operations = [_]*Lookup{ &a, &b };
    var cursor = lookup_batch.Cursor{};
    var expired: [1]CallTable.Expired = undefined;

    for (0..4) |round| {
        const result = try lookup_batch.step(
            &network.transport,
            std.testing.io,
            &operations,
            &cursor,
            &expired,
        );
        try std.testing.expectEqual(@as(u16, 1), result.progress.started);
        const expected_owner = operations[round % 2];
        try std.testing.expectEqual(@as(usize, 1), expected_owner.waitingCount());
        try std.testing.expectEqual(@as(usize, 0), operations[(round + 1) % 2].waitingCount());
        try std.testing.expect(expected_owner.onFailure(&network.transport.engine, waitingCall(expected_owner)));
    }
    try std.testing.expectEqual(@as(usize, 0), network.transport.engine.calls.count());
}

test "lookup batch preserves response and unrelated expiry after refill failure" {
    var network: Network = undefined;
    try network.init(3);
    defer network.deinit();
    const unrelated = network.seed(3);
    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0xff}),
        .enr_sequence = 1,
    } };
    const unrelated_handle = try network.transport.engine.calls.begin(
        unrelated.peer,
        &unrelated.record.public_key,
        &request,
        0,
        1_000,
    );
    const seeds = [_]RoutingTable.Entry{ network.seed(1), network.seed(2) };
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, network.transport.engine.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);
    defer operation.cancel(&network.transport.engine);
    const request_id = try message.RequestId.init(&.{1});
    var buffer: [1_280]u8 = undefined;
    _ = (try operation.startNext(
        &network.transport.engine,
        &buffer,
        request_id,
        try Transport.monotonicMilliseconds(std.testing.io),
        &sealEntropy(1),
    )).?;
    const Entropy = struct {
        threadlocal var failed = false;
        fn random(userdata: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
            if (!failed) {
                failed = true;
                return error.EntropyUnavailable;
            }
            return std.testing.io.vtable.randomSecure(userdata, bytes);
        }
    };
    Entropy.failed = false;
    var vtable = std.testing.io.vtable.*;
    vtable.randomSecure = Entropy.random;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    try network.sendNodes(seeds[0].peer.node_id, request_id);
    var expired: [3]CallTable.Expired = undefined;
    var cursor = lookup_batch.Cursor{};

    const result = try lookup_batch.step(
        &network.transport,
        io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(error.EntropyUnavailable, result.failure.?);
    try std.testing.expectEqual(@as(u16, 1), result.progress.responses);
    try std.testing.expectEqual(@as(?u16, 0), result.consumed);
    try std.testing.expectEqual(@as(usize, 1), result.transport.calls_expired);
    try std.testing.expectEqual(unrelated_handle, expired[0].handle);
    try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
    try std.testing.expectEqual(@as(u16, 1), operation.statistics().queries_started);
    try std.testing.expectEqual(@as(usize, 0), network.transport.engine.calls.count());
}

test "lookup batch consumes expiry before reporting a transport fault" {
    var network: Network = undefined;
    try network.init(1);
    defer network.deinit();
    const seeds = [_]RoutingTable.Entry{ network.seed(1), network.seed(2) };
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, network.transport.engine.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);
    defer operation.cancel(&network.transport.engine);
    var buffer: [1_280]u8 = undefined;
    _ = (try operation.startNext(
        &network.transport.engine,
        &buffer,
        try message.RequestId.init(&.{1}),
        0,
        &sealEntropy(1),
    )).?;
    const Fault = struct {
        fn receive(_: ?*anyopaque, _: *std.Io.Batch, _: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
            return error.Canceled;
        }
    };
    var vtable = std.testing.io.vtable.*;
    vtable.batchAwaitConcurrent = Fault.receive;
    const failed_io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    try network.remote.sendTo(std.testing.io, discv5.types.Address.fromNetwork(network.transport.sockets.primary().address), &.{0xff}, discv5.wire.constants.packet_size_max);
    var expired: [1]CallTable.Expired = undefined;
    var cursor = lookup_batch.Cursor{};

    const result = try lookup_batch.step(
        &network.transport,
        failed_io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(error.Canceled, result.failure.?);
    try std.testing.expectEqual(error.Canceled, result.transport.failure.?.cause);
    try std.testing.expectEqual(@as(u16, 1), result.progress.failures);
    try std.testing.expectEqual(@as(usize, 0), result.transport.calls_expired);
    try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
    try std.testing.expectEqual(@as(u16, 1), operation.statistics().queries_started);
    try std.testing.expectEqual(@as(usize, 0), network.transport.engine.calls.count());
}

test "lookup batch consumes only owned failed-call events" {
    var network: Network = undefined;
    try network.init(1);
    defer network.deinit();
    const seed = network.seed(1);
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    var expired: [1]CallTable.Expired = undefined;
    var cursor = lookup_batch.Cursor{};
    try operation.init(&candidates, network.transport.engine.localRecord().node_id, [_]u8{0} ** 32, &.{seed}, .dual);
    defer operation.cancel(&network.transport.engine);

    for (0..2) |round| {
        var buffer: [1_280]u8 = undefined;
        const now_ms = try Transport.monotonicMilliseconds(std.testing.io);
        const request_id = try message.RequestId.init(&.{@intCast(round)});
        const entropy = sealEntropy(@intCast(round));
        const started = if (round == 0) (try operation.startNext(
            &network.transport.engine,
            &buffer,
            request_id,
            now_ms,
            &entropy,
        )).?.call else try network.transport.engine.startCall(
            &buffer,
            seed.peer,
            &seed.record,
            &.{ .ping = .{ .request_id = request_id, .enr_sequence = 1 } },
            now_ms,
            &entropy,
        );
        try network.challenge(buffer[0..started.packet_length]);
        const result = try lookup_batch.step(
            &network.transport,
            std.testing.io,
            &.{&operation},
            &cursor,
            &expired,
        );
        try std.testing.expectEqual(@as(?lookup_batch.Error, null), result.failure);
        try std.testing.expect(result.transport.event == .failed);
        try std.testing.expectEqual(started.handle, result.transport.event.failed.handle);
        try std.testing.expectEqual(error.InvalidPublicKey, result.transport.event.failed.reason);
        if (round == 0) {
            try std.testing.expectEqual(@as(?u16, 0), result.consumed);
            try std.testing.expectEqual(@as(u16, 1), result.progress.failures);
            try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
            try std.testing.expectEqual(Lookup.FinishReason.exhausted, operation.finishReason().?);
        } else {
            try std.testing.expectEqual(@as(?u16, null), result.consumed);
            try std.testing.expectEqual(@as(u16, 0), result.progress.failures);
            try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
        }
        try std.testing.expectEqual(@as(usize, 0), network.transport.engine.calls.count());
    }
}

test "lookup batch cancellation skips receive and preserves owned and unrelated expiry" {
    var network: Network = undefined;
    try network.init(3);
    defer network.deinit();
    const seeds = [_]RoutingTable.Entry{ network.seed(1), network.seed(2) };
    const unrelated = network.seed(3);
    const request: message.Message = .{ .ping = .{
        .request_id = try message.RequestId.init(&.{0xff}),
        .enr_sequence = 1,
    } };
    const handle = try network.transport.engine.calls.begin(unrelated.peer, &unrelated.record.public_key, &request, 0, 100_000);
    var operation: Lookup = undefined;
    var candidates: Lookup.Candidates = undefined;
    try operation.init(&candidates, network.transport.engine.localRecord().node_id, [_]u8{0} ** 32, &seeds, .dual);
    defer operation.cancel(&network.transport.engine);
    var buffer: [1_280]u8 = undefined;
    _ = (try operation.startNext(&network.transport.engine, &buffer, try message.RequestId.init(&.{1}), 0, &sealEntropy(1))).?;

    var host: CancelSendIo = .{};
    var cursor: lookup_batch.Cursor = .{};
    var expired: [3]CallTable.Expired = undefined;
    const result = try lookup_batch.step(&network.transport, host.io(), &.{&operation}, &cursor, &expired);
    try std.testing.expectEqual(error.Canceled, result.failure.?);
    try std.testing.expect(result.transport.cancelled);
    try std.testing.expectEqual(@as(usize, 1), host.sends);
    try std.testing.expectEqual(@as(usize, 0), host.receives);
    try std.testing.expectEqual(@as(u16, 2), result.progress.failures);
    try std.testing.expectEqual(@as(usize, 1), result.transport.calls_expired);
    try std.testing.expectEqual(handle, expired[0].handle);
    try std.testing.expectEqual(@as(usize, 0), operation.waitingCount());
    try std.testing.expectEqual(@as(usize, 0), network.transport.engine.calls.count());
}

const CancelSendIo = struct {
    sends: usize = 0,
    receives: usize = 0,

    fn io(self: *CancelSendIo) std.Io {
        const vtable = comptime blk: {
            var value = std.Io.failing.vtable.*;
            value.now = now;
            value.randomSecure = random;
            value.netSend = send;
            value.batchAwaitConcurrent = receive;
            value.batchCancel = cancel;
            break :blk value;
        };
        return .{ .userdata = self, .vtable = &vtable };
    }

    fn now(_: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
        return .{ .nanoseconds = 100_000 * std.time.ns_per_ms };
    }

    fn random(_: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
        @memset(bytes, 0x55);
    }

    fn send(context: ?*anyopaque, _: net.Socket.Handle, _: []net.OutgoingMessage, _: net.SendFlags) struct { ?net.Socket.SendError, usize } {
        const self: *CancelSendIo = @ptrCast(@alignCast(context.?));
        self.sends += 1;
        return .{ error.Canceled, 0 };
    }

    fn receive(context: ?*anyopaque, _: *std.Io.Batch, _: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
        const self: *CancelSendIo = @ptrCast(@alignCast(context.?));
        self.receives += 1;
        return error.Timeout;
    }

    fn cancel(_: ?*anyopaque, batch: *std.Io.Batch) void {
        std.debug.assert(batch.pending.head == .none);
    }
};

const Network = struct {
    remote: Sockets,
    transport: Transport,

    fn init(self: *Network, call_capacity: usize) !void {
        const loopback = std.Io.net.IpAddress{ .ip4 = .loopback(0) };
        self.transport.sockets = try Sockets.bind(std.testing.io, .single(loopback));
        errdefer self.transport.sockets.close(std.testing.io);
        self.remote = try Sockets.bind(std.testing.io, .single(loopback));
        errdefer self.remote.close(std.testing.io);
        const key = try keyPair(0x11);
        const record = try enr.Record.create(&key, 1, discv5.types.Address.fromNetwork(self.transport.sockets.primary().address));
        try self.transport.init(std.testing.allocator, self.transport.sockets, key, record, .{
            .session_capacity = 8,
            .challenge_capacity = 4,
            .call_capacity = call_capacity,
            .request_timeout_ms = 100_000,
            .challenge_timeout_ms = 1_000,
            .session_idle_timeout_ms = std.math.maxInt(u64),
        });
    }

    fn deinit(self: *Network) void {
        self.transport.deinit(std.testing.allocator, std.testing.io);
        self.remote.close(std.testing.io);
    }

    fn seed(self: *Network, id: u8) RoutingTable.Entry {
        const peer = types.Endpoint{
            .node_id = [_]u8{id} ** 32,
            .address = discv5.types.Address.fromNetwork(self.remote.primary().address),
        };
        installSession(&self.transport.engine, peer, 0x55);
        var record = std.mem.zeroes(enr.Record);
        record.node_id = peer.node_id;
        record.sequence = 1;
        record.ip4 = peer.address.ip4.octets;
        record.udp = peer.address.ip4.port;
        return .{
            .peer = peer,
            .record = record,
            .last_verified_ms = 0,
            .direction = .outgoing,
        };
    }

    fn sendNodes(self: *Network, source_id: types.NodeId, request_id: message.RequestId) !void {
        const response = message.Message{ .nodes = .{
            .request_id = request_id,
            .total = 1,
            .enrs = &.{},
        } };
        var plaintext: [1_000]u8 = undefined;
        var out: [1_280]u8 = undefined;
        const bytes = try packet.encodeOrdinary(&out, .{
            .source_id = &source_id,
            .packet = .{
                .masking_iv = &([_]u8{0x22} ** 16),
                .recipient_id = &self.transport.engine.localRecord().node_id,
                .nonce = &([_]u8{0x77} ** 12),
                .write_key = &([_]u8{0x55} ** 16),
                .plaintext = try response.encode(&plaintext),
            },
        });
        try self.remote.sendTo(std.testing.io, discv5.types.Address.fromNetwork(self.transport.sockets.primary().address), bytes, discv5.wire.constants.packet_size_max);
        try waitForDatagram(self.transport.sockets.primary());
    }

    fn challenge(self: *Network, request: []const u8) !void {
        var scratch: packet.DecodeScratch = .{};
        const source_id = [_]u8{1} ** 32;
        const decoded = try packet.decode(request, &source_id, &scratch);
        var out: [1_280]u8 = undefined;
        const bytes = try packet.encodeWhoareyou(&out, .{
            .masking_iv = &([_]u8{0x33} ** 16),
            .recipient_id = &self.transport.engine.localRecord().node_id,
            .request_nonce = &decoded.static_header.nonce,
            .id_nonce = &([_]u8{0x44} ** 16),
            .enr_sequence = 0,
        }, null);
        try self.remote.sendTo(std.testing.io, discv5.types.Address.fromNetwork(self.transport.sockets.primary().address), bytes, discv5.wire.constants.packet_size_max);
        try waitForDatagram(self.transport.sockets.primary());
    }
};

fn waitingCall(operation: *const Lookup) CallTable.Handle {
    for (operation.candidates[0..operation.candidateCount()]) |*candidate| {
        if (candidate.state == .waiting) return candidate.state.waiting;
    }
    unreachable;
}

test "transport completes a caller-owned lookup across multiple peers" {
    var network: LookupNetwork = undefined;
    try network.init(1_000);
    defer network.deinit();

    var seed_buffer: [Lookup.result_max]RoutingTable.Entry = undefined;
    const seeds = network.transport_a.engine.closestNodes(&network.record_c.node_id, &seed_buffer);
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, network.record_a.node_id, network.record_c.node_id, seeds, .dual);

    var cursor: lookup_batch.Cursor = .{};
    var expired: [4]CallTable.Expired = undefined;
    const first = try lookup_batch.step(
        &network.transport_a,
        std.testing.io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(@as(u16, 1), first.progress.started);
    try std.testing.expectEqual(@as(usize, 0), first.transport.calls_expired);

    const from_b = try discv5.driver.step(&network.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(25) });
    try std.testing.expectEqual(@as(u8, 1), from_b.standard_responses);
    const second = try lookup_batch.step(
        &network.transport_a,
        std.testing.io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(@as(u16, 1), second.progress.responses);
    try std.testing.expectEqual(@as(u16, 1), second.progress.started);
    try std.testing.expectEqual(@as(?u16, 0), second.consumed);

    const from_c = try discv5.driver.step(&network.transport_c, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(25) });
    try std.testing.expectEqual(@as(u8, 1), from_c.standard_responses);
    const completed = try lookup_batch.step(
        &network.transport_a,
        std.testing.io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(@as(u16, 1), completed.progress.responses);
    try std.testing.expect(operation.isFinished());
    try std.testing.expectEqual(@as(usize, 0), network.transport_a.engine.calls.count());
    try std.testing.expect(network.transport_a.engine.routing.contains(&network.record_c.node_id));

    try std.testing.expectEqualDeep(endpoint(&network.record_b), second.transport.event.response.peer);
    try std.testing.expectEqualDeep(endpoint(&network.record_c), completed.transport.event.response.peer);
    try std.testing.expectEqual(@as(u16, 2), operation.statistics().queries_started);
}

test "lookup expiry is consumed without hiding an unrelated call expiry" {
    var network: LookupNetwork = undefined;
    try network.init(1);
    defer network.deinit();

    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x24}),
        .enr_sequence = network.record_a.sequence,
    } };
    var output: [1_280]u8 = undefined;
    const caller = try network.transport_a.engine.startCall(
        &output,
        endpoint(&network.record_c),
        &network.record_c,
        &request,
        0,
        &sealEntropy(10),
    );
    const caller_handle = caller.handle;
    var seed_buffer: [Lookup.result_max]RoutingTable.Entry = undefined;
    const seeds = network.transport_a.engine.closestNodes(&network.record_c.node_id, &seed_buffer);
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, network.record_a.node_id, network.record_c.node_id, seeds, .dual);

    defer operation.cancel(&network.transport_a.engine);
    _ = (try operation.startNext(
        &network.transport_a.engine,
        &output,
        try message.RequestId.init(&.{0x25}),
        0,
        &sealEntropy(20),
    )).?;

    const ExpiredIo = struct {
        fn now(_: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
            return .{ .nanoseconds = std.time.ns_per_ms };
        }
        fn random(_: ?*anyopaque, bytes: []u8) std.Io.RandomSecureError!void {
            @memset(bytes, 0x11);
        }
        fn receive(_: ?*anyopaque, _: *std.Io.Batch, _: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
            return error.Timeout;
        }
        fn cancel(_: ?*anyopaque, batch: *std.Io.Batch) void {
            std.debug.assert(batch.pending.head == .none);
        }
    };
    var vtable = std.Io.failing.vtable.*;
    vtable.now = ExpiredIo.now;
    vtable.randomSecure = ExpiredIo.random;
    vtable.batchAwaitConcurrent = ExpiredIo.receive;
    vtable.batchCancel = ExpiredIo.cancel;
    const expired_io: std.Io = .{ .userdata = null, .vtable = &vtable };
    var cursor: lookup_batch.Cursor = .{};
    var expired: [4]CallTable.Expired = undefined;
    const result = try lookup_batch.step(
        &network.transport_a,
        expired_io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(@as(u16, 0), result.progress.started);
    try std.testing.expectEqual(@as(u16, 1), result.progress.failures);
    try std.testing.expectEqual(@as(usize, 1), result.transport.calls_expired);
    try std.testing.expectEqual(caller_handle, expired[0].handle);
    try std.testing.expect(operation.isFinished());
    try std.testing.expectEqual(@as(usize, 0), network.transport_a.engine.calls.count());
}

test "lookup step preserves an unrelated response event" {
    var network: LookupNetwork = undefined;
    try network.init(1_000);
    defer network.deinit();

    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x25}),
        .enr_sequence = network.record_a.sequence,
    } };
    const caller_handle = try network.transport_a.startCall(std.testing.io, endpoint(&network.record_c), &network.record_c, &request, try Transport.monotonicMilliseconds(std.testing.io));
    var cursor: lookup_batch.Cursor = .{};
    var expired: [4]CallTable.Expired = undefined;
    const answered = try discv5.driver.step(&network.transport_c, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(25) });
    try std.testing.expectEqual(@as(u8, 1), answered.standard_responses);

    var seed_buffer: [Lookup.result_max]RoutingTable.Entry = undefined;
    const seeds = network.transport_a.engine.closestNodes(&network.record_c.node_id, &seed_buffer);
    var operation: Lookup = undefined;
    var operation_candidates: Lookup.Candidates = undefined;
    try operation.init(&operation_candidates, network.record_a.node_id, network.record_c.node_id, seeds, .dual);
    defer operation.cancel(&network.transport_a.engine);

    const result = try lookup_batch.step(
        &network.transport_a,
        std.testing.io,
        &.{&operation},
        &cursor,
        &expired,
    );
    try std.testing.expectEqual(@as(u16, 1), result.progress.started);
    try std.testing.expectEqual(@as(u16, 0), result.progress.responses);
    try std.testing.expect(result.consumed == null);
    try std.testing.expect(result.transport.event == .response);
    try std.testing.expectEqual(
        caller_handle,
        result.transport.event.response.matched.handle,
    );
}

test "two caller-owned lookups share one transport" {
    var network: LookupNetwork = undefined;
    try network.init(1_000);
    defer network.deinit();

    const peer_c = endpoint(&network.record_c);
    _ = try network.transport_a.engine.confirmPeer(&peer_c, &network.record_c, 0);
    var seeds_b_buffer: [Lookup.result_max]RoutingTable.Entry = undefined;
    const seeds_b = network.transport_a.engine.closestNodes(
        &network.record_b.node_id,
        &seeds_b_buffer,
    );
    var operation_b: Lookup = undefined;
    var operation_b_candidates: Lookup.Candidates = undefined;
    try operation_b.init(
        &operation_b_candidates,
        network.record_a.node_id,
        network.record_b.node_id,
        seeds_b,
        .dual,
    );
    defer operation_b.cancel(&network.transport_a.engine);
    var seeds_c_buffer: [Lookup.result_max]RoutingTable.Entry = undefined;
    const seeds_c = network.transport_a.engine.closestNodes(
        &network.record_c.node_id,
        &seeds_c_buffer,
    );
    var operation_c: Lookup = undefined;
    var operation_c_candidates: Lookup.Candidates = undefined;
    try operation_c.init(
        &operation_c_candidates,
        network.record_a.node_id,
        network.record_c.node_id,
        seeds_c,
        .dual,
    );
    defer operation_c.cancel(&network.transport_a.engine);

    var cursor: lookup_batch.Cursor = .{};
    var expired: [4]CallTable.Expired = undefined;
    var responses_b: usize = 0;
    var responses_c: usize = 0;
    var responders: [2]u2 = @splat(0);
    for (0..32) |_| {
        if (operation_b.isFinished() and operation_c.isFinished()) break;
        const result = try lookup_batch.step(
            &network.transport_a,
            std.testing.io,
            &.{ &operation_b, &operation_c },
            &cursor,
            &expired,
        );
        try std.testing.expect(result.transport.event != .response or result.consumed != null);
        if (result.consumed) |index| {
            const peer = result.transport.event.response.peer;
            if (std.mem.eql(u8, &peer.node_id, &network.record_b.node_id)) {
                responders[index] |= 1;
            } else {
                try std.testing.expectEqual(network.record_c.node_id, peer.node_id);
                responders[index] |= 2;
            }
            switch (index) {
                0 => responses_b += 1,
                1 => responses_c += 1,
                else => return error.TestUnexpectedResult,
            }
        }
        _ = try discv5.driver.step(&network.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(25) });
        _ = try discv5.driver.step(&network.transport_c, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(25) });
    }
    try std.testing.expect(operation_b.isFinished());
    try std.testing.expect(operation_c.isFinished());
    try std.testing.expectEqual(@as(usize, 2), responses_b);
    try std.testing.expectEqual(@as(usize, 2), responses_c);
    try std.testing.expectEqual(@as(usize, 0), network.transport_a.engine.calls.count());

    try std.testing.expectEqual([_]u2{ 3, 3 }, responders);
}

const LookupNetwork = struct {
    record_a: enr.Record,
    record_b: enr.Record,
    record_c: enr.Record,
    transport_a: Transport,
    transport_b: Transport,
    transport_c: Transport,

    fn init(self: *LookupNetwork, request_timeout_ms: u64) !void {
        const loopback = net.IpAddress{ .ip4 = .loopback(0) };
        self.transport_a.sockets = try Sockets.bind(std.testing.io, .single(loopback));
        errdefer self.transport_a.sockets.close(std.testing.io);
        self.transport_b.sockets = try Sockets.bind(std.testing.io, .single(loopback));
        errdefer self.transport_b.sockets.close(std.testing.io);
        self.transport_c.sockets = try Sockets.bind(std.testing.io, .single(loopback));
        errdefer self.transport_c.sockets.close(std.testing.io);

        const key_a = try keyPair(0x11);
        const key_b = try keyPair(0x22);
        const key_c = try keyPair(0x33);
        self.record_a = try enr.Record.create(&key_a, 1, self.transport_a.localAddress());
        self.record_b = try enr.Record.create(&key_b, 1, self.transport_b.localAddress());
        self.record_c = try enr.Record.create(&key_c, 1, self.transport_c.localAddress());
        const config = Engine.Config{
            .session_capacity = 4,
            .challenge_capacity = 4,
            .call_capacity = 4,
            .request_timeout_ms = request_timeout_ms,
            .challenge_timeout_ms = 1_000,
            .session_idle_timeout_ms = std.math.maxInt(u64),
        };
        try self.transport_a.init(std.testing.allocator, self.transport_a.sockets, key_a, self.record_a, config);
        errdefer self.transport_a.engine.deinit(std.testing.allocator);
        try self.transport_b.init(std.testing.allocator, self.transport_b.sockets, key_b, self.record_b, config);
        errdefer self.transport_b.engine.deinit(std.testing.allocator);
        try self.transport_c.init(std.testing.allocator, self.transport_c.sockets, key_c, self.record_c, config);
        errdefer self.transport_c.engine.deinit(std.testing.allocator);

        installSession(&self.transport_a.engine, endpoint(&self.record_b), 0x51);
        installSession(&self.transport_b.engine, endpoint(&self.record_a), 0x51);
        installSession(&self.transport_a.engine, endpoint(&self.record_c), 0x52);
        installSession(&self.transport_c.engine, endpoint(&self.record_a), 0x52);

        const peer_b = endpoint(&self.record_b);
        const peer_c = endpoint(&self.record_c);
        _ = try self.transport_a.engine.confirmPeer(&peer_b, &self.record_b, 0);
        _ = try self.transport_b.engine.confirmPeer(&peer_c, &self.record_c, 0);
    }

    fn deinit(self: *LookupNetwork) void {
        self.transport_c.deinit(std.testing.allocator, std.testing.io);
        self.transport_b.deinit(std.testing.allocator, std.testing.io);
        self.transport_a.deinit(std.testing.allocator, std.testing.io);
    }
};

fn keyPair(seed: u8) !discv5.identity.crypto.KeyPair {
    return discv5.identity.crypto.keyPairFromSecret(&([_]u8{seed} ** 32));
}

fn endpoint(record: *const enr.Record) types.Endpoint {
    return .{ .node_id = record.node_id, .address = record.endpoint().? };
}

fn installSession(core: *Engine, peer: types.Endpoint, key_byte: u8) void {
    const key = [_]u8{key_byte} ** 16;
    const active = discv5.SessionStore.Session{ .read_key = key, .write_key = key };
    core.channel.sessions.install(peer, &active, 0);
}

fn sealEntropy(seed: u8) Engine.StartEntropy {
    return .{
        .masking_iv = [_]u8{seed} ** 16,
        .nonce = [_]u8{seed +% 1} ** 12,
        .nonce_tail = [_]u8{seed +% 2} ** 8,
        .sessionless_key = [_]u8{seed +% 3} ** 16,
    };
}
