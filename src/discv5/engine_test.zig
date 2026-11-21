const std = @import("std");
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const PendingResponse = @import("PendingResponse.zig");
const crypto = @import("identity/crypto.zig");
const enr = @import("identity/enr.zig");
const message = @import("wire/message.zig");
const packet = @import("wire/packet.zig");
const engine_session = @import("SessionStore.zig");
const test_support = @import("test_support.zig");
const types = @import("types.zig");
const Admission = @import("Admission.zig");

const engineConfig = test_support.engineConfig;
const keyPair = test_support.keyPair;
const loopback = test_support.loopback;
const receiveArgs = test_support.receiveArgs;
const sealEntropy = test_support.sealEntropy;

const TestEngine = Engine;

test "NODES record validation rejects malformed ENRs before publication" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
    const request: message.Message = .{ .find_node = .{ .request_id = try .init(&.{1}), .distances = &.{256} } };
    const started = try pair.node_a.startCall(&pair.a_to_b, pair.peerB(), &pair.record_b, &request, 1, &sealEntropy(0x20));
    const received = try receiveMalformedNodes(&pair);
    try std.testing.expectEqual(types.RejectReason.invalid_record, received.rejected);
    try std.testing.expectEqual(@as(usize, 1), pair.node_a.calls.count());
    try std.testing.expect(pair.node_a.cancelCall(started.handle));
}

test "unsolicited NODES fails before record validation" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
    const received = try receiveMalformedNodes(&pair);
    try std.testing.expectEqual(types.RejectReason.unsolicited_response, received.rejected);
    const record_stage = @intFromEnum(Admission.Stage.record);
    try std.testing.expectEqual(@as(u64, 0), pair.node_a.channel.admission.global[record_stage].charged_until_ms);
    try std.testing.expectEqual(@as(usize, 0), pair.node_a.calls.count());
}

fn receiveMalformedNodes(pair: *Pair) !Engine.Outcome {
    const response: message.Message = .{ .nodes = .{
        .request_id = try .init(&.{1}),
        .total = 1,
        .enrs = &.{&.{0xc0}},
    } };
    var buffer: [1_280]u8 = undefined;
    const plaintext = try response.encode(&buffer);
    const sealed = try pair.node_b.channel.sealEstablished(&pair.b_to_a, pair.peerA(), plaintext, &sealEntropy(0x30), 2);
    return pair.node_a.receive(&pair.a_to_b, pair.b_to_a[0..sealed.packet_length], pair.address_b, receiveArgs(2, 0x40), &pair.scratch_a);
}

test "paired engines recover a session and complete one call without queues" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const recovery = try pair.beginRecovery();
    const request = try pair.authenticate(recovery.handshake_length);
    try pair.completePong(recovery.started, &request);
}

test "paired engines return the local record for FINDNODE distance zero" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const recovery = try pair.beginRecovery();
    const handshake_request = try pair.authenticate(recovery.handshake_length);
    try pair.completePong(recovery.started, &handshake_request);

    const request = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{0x04}),
        .distances = &.{0},
    } };
    const started = try pair.node_b.startCall(
        &pair.b_to_a,
        pair.peerA(),
        &pair.record_a,
        &request,
        8,
        &sealEntropy(0xb0),
    );
    const received = try pair.node_a.receive(
        &pair.a_to_b,
        pair.b_to_a[0..started.packet_length],
        pair.address_b,
        receiveArgs(9, 0xb1),
        &pair.scratch_a,
    );
    try std.testing.expect(received.accepted.event == .request);
    var response: PendingResponse = .{};
    try pair.node_a.prepareStandardResponse(
        &received.accepted.event.request,
        &response,
    );
    const response_length = (try pair.node_a.encodeNextStandardResponse(
        &pair.a_to_b,
        &response,
        10,
        &sealEntropy(0xb2),
    )).?;
    try std.testing.expect(response.complete());
    const completed = try pair.node_b.receive(
        &pair.b_to_a,
        pair.a_to_b[0..response_length],
        pair.address_a,
        receiveArgs(11, 0xb3),
        &pair.scratch_b,
    );
    try std.testing.expect(completed.accepted.event == .response);
    try std.testing.expectEqual(
        started.handle,
        completed.accepted.event.response.matched.handle,
    );
    try std.testing.expectEqual(
        @as(usize, 1),
        completed.accepted.event.response.node_records.len,
    );
    try std.testing.expectEqual(
        pair.record_a.node_id,
        completed.accepted.event.response.node_records[0].node_id,
    );
}

test "paired engines filter NODES records by the requested distance" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const recovery = try pair.beginRecovery();
    const handshake_request = try pair.authenticate(recovery.handshake_length);
    try pair.completePong(recovery.started, &handshake_request);

    const requested_distance = types.logDistance(
        &pair.record_b.node_id,
        &pair.record_a.node_id,
    );
    const request = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{0x03}),
        .distances = &.{requested_distance},
    } };
    const started = try pair.node_a.startCall(
        &pair.a_to_b,
        pair.peerB(),
        &pair.record_b,
        &request,
        12,
        &sealEntropy(0x81),
    );
    const received = try pair.node_b.receive(
        &pair.b_to_a,
        pair.a_to_b[0..started.packet_length],
        pair.address_a,
        receiveArgs(13, 0x82),
        &pair.scratch_b,
    );
    try std.testing.expect(received.accepted.event == .request);

    const raw_records = [_][]const u8{ pair.record_a.slice(), pair.record_b.slice() };
    const response = message.Message{ .nodes = .{
        .request_id = request.find_node.request_id,
        .total = 1,
        .enrs = &raw_records,
    } };
    const response_length = try pair.node_b.sendResponse(
        &pair.b_to_a,
        pair.peerA(),
        &response,
        14,
        &sealEntropy(0x83),
    );
    const completed = try pair.node_a.receive(
        &pair.a_to_b,
        pair.b_to_a[0..response_length],
        pair.address_b,
        receiveArgs(15, 0x84),
        &pair.scratch_a,
    );
    try std.testing.expect(completed.accepted.event == .response);
    try std.testing.expectEqual(
        @as(usize, 1),
        completed.accepted.event.response.node_records.len,
    );
    try std.testing.expectEqual(
        pair.record_a.node_id,
        completed.accepted.event.response.node_records[0].node_id,
    );
    try std.testing.expectEqual(
        @as(usize, 1),
        completed.accepted.event.response.matched.response.nodes.enrs.len,
    );
}

test "paired engines expire an unanswered call over an established session" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const recovery = try pair.beginRecovery();
    const handshake_request = try pair.authenticate(recovery.handshake_length);
    try pair.completePong(recovery.started, &handshake_request);

    const ping_message = pair.ping(2);
    const started = try pair.node_a.startCall(
        &pair.a_to_b,
        pair.peerB(),
        &pair.record_b,
        &ping_message,
        16,
        &sealEntropy(0x90),
    );
    const direct_packet = try packet.decode(
        pair.a_to_b[0..started.packet_length],
        &pair.record_b.node_id,
        &pair.scratch_b.channel.packet_decode,
    );
    try std.testing.expectEqualSlices(
        u8,
        &.{ 0, 0, 0, 2 },
        direct_packet.static_header.nonce[0..4],
    );
    const received = try pair.node_b.receive(
        &pair.b_to_a,
        pair.a_to_b[0..started.packet_length],
        pair.address_a,
        receiveArgs(17, 0xa0),
        &pair.scratch_b,
    );
    try std.testing.expectEqual(@as(u16, 0), received.accepted.packet_length);
    try std.testing.expect(received.accepted.event == .request);
    try std.testing.expect(received.accepted.event.request.record == null);
    var expired: [1]CallTable.Expired = undefined;
    const tick = pair.node_a.expire(116, &expired);
    try std.testing.expectEqual(@as(usize, 1), tick.calls);
    try std.testing.expectEqual(started.handle, expired[0].handle);
}

test "engine reports source admission pressure without a local failure" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const sealed = try pair.node_a.channel.seal(&pair.a_to_b, pair.peerB(), "ping", &sealEntropy(0x10), 0);
    var source = pair.address_a;
    for (0..Admission.source_quota.burst) |i| {
        source.ip4.port = @intCast(9_000 + i);
        const outcome = try pair.node_b.receive(&pair.b_to_a, pair.a_to_b[0..sealed.packet_length], source, receiveArgs(0, 0x30), &pair.scratch_b);
        try std.testing.expectEqual(@as(u16, 63), outcome.accepted.packet_length);
    }
    source.ip4.port += 1;
    const limited = try pair.node_b.receive(&pair.b_to_a, pair.a_to_b[0..sealed.packet_length], source, receiveArgs(249, 0x30), &pair.scratch_b);
    try std.testing.expectEqual(types.RejectReason.admission_limited, limited.rejected);
    const recovered = try pair.node_b.receive(&pair.b_to_a, pair.a_to_b[0..sealed.packet_length], source, receiveArgs(250, 0x30), &pair.scratch_b);
    try std.testing.expectEqual(@as(u16, 63), recovered.accepted.packet_length);
}

test "engine limits malformed packets before decoding or touching output" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const limits = @import("Admission.zig");
    for (0..limits.packet_source_quota.burst) |_| {
        const result = try pair.node_b.receive(&pair.b_to_a, &.{}, pair.address_a, receiveArgs(0, 0x30), &pair.scratch_b);
        try std.testing.expectEqual(types.RejectReason.malformed_packet, result.rejected);
    }
    @memset(&pair.b_to_a, 0xaa);
    @memset(&pair.scratch_b.channel.packet_decode.header, 0xbb);
    const result = try pair.node_b.receive(&pair.b_to_a, &.{}, pair.address_a, receiveArgs(0, 0x30), &pair.scratch_b);
    try std.testing.expectEqual(types.RejectReason.admission_limited, result.rejected);
    try std.testing.expect(std.mem.allEqual(u8, &pair.b_to_a, 0xaa));
    try std.testing.expect(std.mem.allEqual(u8, &pair.scratch_b.channel.packet_decode.header, 0xbb));
}

test "engine admits fragmented expected responses through unsolicited packet exhaustion" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const limits = @import("Admission.zig");
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
    const request = message.Message{ .find_node = .{ .request_id = try .init(&.{1}), .distances = &.{256} } };
    const started = try pair.node_a.startCall(&pair.a_to_b, pair.peerB(), &pair.record_b, &request, 1, &sealEntropy(0x20));
    _ = try pair.node_b.receive(&pair.b_to_a, pair.a_to_b[0..started.packet_length], pair.address_a, receiveArgs(2, 0x30), &pair.scratch_b);
    for (0..limits.packet_global_quota.burst) |i| {
        const from = test_support.address4(192, 0, 2, @intCast(i), 9_000);
        const result = try pair.node_a.receive(&pair.a_to_b, &.{}, from, receiveArgs(3, 0x30), &pair.scratch_a);
        try std.testing.expectEqual(types.RejectReason.malformed_packet, result.rejected);
    }
    var wrong_port = pair.address_b;
    wrong_port.ip4.port += 1;
    const wrong = try pair.node_a.receive(&pair.a_to_b, &.{}, wrong_port, receiveArgs(3, 0x30), &pair.scratch_a);
    try std.testing.expectEqual(types.RejectReason.admission_limited, wrong.rejected);
    const response = message.Message{ .nodes = .{ .request_id = request.find_node.request_id, .total = types.findnode_response_packets_max, .enrs = &.{} } };
    for (0..types.findnode_response_packets_max) |i| {
        const length = try pair.node_b.sendResponse(&pair.b_to_a, pair.peerA(), &response, 3, &sealEntropy(0x40));
        const received = try pair.node_a.receive(&pair.a_to_b, pair.b_to_a[0..length], pair.address_b, receiveArgs(3, 0x30), &pair.scratch_a);
        try std.testing.expectEqual(started.handle, received.accepted.event.response.matched.handle);
        try std.testing.expectEqual(i + 1 == types.findnode_response_packets_max, received.accepted.event.response.matched.terminal);
    }
    try std.testing.expectEqual(@as(usize, 0), pair.node_a.calls.count());
    const late = try pair.node_a.receive(&pair.a_to_b, &.{}, pair.address_b, receiveArgs(3, 0x30), &pair.scratch_a);
    try std.testing.expectEqual(types.RejectReason.admission_limited, late.rejected);
}

test "established packet pressure cannot refresh a session after receive refusal" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const limits = @import("Admission.zig");
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
    const request = pair.ping(1);
    var plaintext_buffer: [1_280]u8 = undefined;
    const plaintext = try request.encode(&plaintext_buffer);
    const sealed = try pair.node_a.channel.sealEstablished(&pair.a_to_b, pair.peerB(), plaintext, &sealEntropy(0x20), 0);
    for (0..limits.packet_source_quota.burst) |_| {
        const received = try pair.node_b.receive(&pair.b_to_a, pair.a_to_b[0..sealed.packet_length], pair.address_a, receiveArgs(0, 0x30), &pair.scratch_b);
        try std.testing.expect(received.accepted.event == .request);
    }
    const refused = try pair.node_b.receive(&pair.b_to_a, pair.a_to_b[0..sealed.packet_length], pair.address_a, receiveArgs(24, 0x30), &pair.scratch_b);
    try std.testing.expectEqual(types.RejectReason.admission_limited, refused.rejected);
    try std.testing.expectEqual(@as(usize, 1), pair.node_b.channel.expire(1_000).sessions);
}

test "engine derives challenge storage from quotas and lifetime within the configured ceiling" {
    const key = try keyPair(0x11);
    const record = try enr.Record.create(&key, 1, loopback(1, 9_001));
    for ([_]struct { config: Engine.Config, expected: usize }{
        .{ .config = .{}, .expected = 40 },
        .{ .config = .{ .challenge_timeout_ms = 1_001 }, .expected = 41 },
        .{ .config = .{ .challenge_capacity = 8 }, .expected = 8 },
    }) |case| {
        var engine: Engine = undefined;
        try engine.init(std.testing.allocator, key, record, case.config);
        defer engine.deinit(std.testing.allocator);
        try std.testing.expectEqual(case.expected, engine.channel.sessions.challenges.len);
    }
}

test "matched NODES consumes record credit before validation and retains the call on refusal" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
    const request = message.Message{ .find_node = .{ .request_id = try .init(&.{1}), .distances = &.{0} } };
    _ = try pair.node_a.startCall(&pair.a_to_b, pair.peerB(), &pair.record_b, &request, 1, &sealEntropy(0x20));
    var corrupt = pair.record_b.bytes;
    corrupt[10] ^= 1;
    const response = message.Message{ .nodes = .{ .request_id = request.find_node.request_id, .total = 1, .enrs = &.{corrupt[0..pair.record_b.length]} } };
    var plaintext_buffer: [1_280]u8 = undefined;
    const plaintext = try response.encode(&plaintext_buffer);
    const sealed = try pair.node_b.channel.sealEstablished(&pair.b_to_a, pair.peerA(), plaintext, &sealEntropy(0x30), 1);
    for (0..2) |_| try std.testing.expect(pair.node_a.channel.admission.allowRecords(&pair.address_b, types.findnode_result_max, 0));
    const refused = try pair.node_a.receive(&pair.a_to_b, pair.b_to_a[0..sealed.packet_length], pair.address_b, receiveArgs(2, 0x40), &pair.scratch_a);
    try std.testing.expectEqual(types.RejectReason.record_admission_limited, refused.rejected);
    try std.testing.expectEqual(@as(usize, 1), pair.node_a.calls.count());
    const admitted = try pair.node_a.receive(&pair.a_to_b, pair.b_to_a[0..sealed.packet_length], pair.address_b, receiveArgs(5, 0x40), &pair.scratch_a);
    try std.testing.expectEqual(types.RejectReason.invalid_record, admitted.rejected);
}

test "engine construction releases all allocations on partial failure" {
    const key = try keyPair(0x11);
    const record = try enr.Record.create(&key, 1, loopback(1, 9_001));
    const Construction = struct {
        fn run(allocator: std.mem.Allocator, local_key: *const crypto.KeyPair, local_record: *const enr.Record) !void {
            var engine: Engine = undefined;
            try engine.init(allocator, local_key.*, local_record.*, engineConfig());
            defer engine.deinit(allocator);
        }
    };
    try std.testing.checkAllAllocationFailures(std.testing.allocator, Construction.run, .{ &key, &record });
}

const Pair = struct {
    address_a: types.Address,
    address_b: types.Address,
    record_a: enr.Record,
    record_b: enr.Record,
    node_a: TestEngine,
    node_b: TestEngine,
    a_to_b: [1_280]u8,
    b_to_a: [1_280]u8,
    scratch_a: Engine.Scratch,
    scratch_b: Engine.Scratch,

    const Recovery = struct {
        started: Engine.StartResult,
        handshake_length: u16,
    };

    fn init(self: *Pair) !void {
        self.address_a = loopback(1, 9_001);
        self.address_b = loopback(2, 9_002);
        const key_a = try keyPair(0x11);
        const key_b = try keyPair(0x22);
        self.record_a = try enr.Record.create(&key_a, 1, self.address_a);
        self.record_b = try enr.Record.create(&key_b, 1, self.address_b);
        try self.node_a.init(std.testing.allocator, key_a, self.record_a, engineConfig());
        errdefer self.node_a.deinit(std.testing.allocator);
        try self.node_b.init(std.testing.allocator, key_b, self.record_b, engineConfig());
        self.scratch_a = .{};
        self.scratch_b = .{};
    }

    fn deinit(self: *Pair) void {
        self.node_b.deinit(std.testing.allocator);
        self.node_a.deinit(std.testing.allocator);
    }

    fn beginRecovery(self: *Pair) !Recovery {
        const ping_message = self.ping(1);
        var too_small: [1]u8 = undefined;
        try std.testing.expectError(error.BufferTooSmall, self.node_a.startCall(
            &too_small,
            self.peerB(),
            &self.record_b,
            &ping_message,
            1,
            &sealEntropy(0x08),
        ));
        try std.testing.expectEqual(@as(usize, 0), self.node_a.calls.count());
        const started = try self.node_a.startCall(
            &self.a_to_b,
            self.peerB(),
            &self.record_b,
            &ping_message,
            1,
            &sealEntropy(0x10),
        );
        try std.testing.expectError(error.PeerBusy, self.node_a.startCall(
            &self.a_to_b,
            self.peerB(),
            &self.record_b,
            &ping_message,
            1,
            &sealEntropy(0x20),
        ));
        const challenge = try self.node_b.receive(
            &self.b_to_a,
            self.a_to_b[0..started.packet_length],
            self.address_a,
            receiveArgs(2, 0x30),
            &self.scratch_b,
        );
        try std.testing.expectEqual(@as(u16, 63), challenge.accepted.packet_length);
        const response = try self.node_a.receive(
            &self.a_to_b,
            self.b_to_a[0..challenge.accepted.packet_length],
            self.address_b,
            receiveArgs(3, 0x40),
            &self.scratch_a,
        );
        try std.testing.expect(response.accepted.packet_length > 63);
        const handshake_packet = try packet.decode(
            self.a_to_b[0..response.accepted.packet_length],
            &self.record_b.node_id,
            &self.scratch_b.channel.packet_decode,
        );
        try std.testing.expectEqualSlices(
            u8,
            &.{ 0, 0, 0, 1 },
            handshake_packet.static_header.nonce[0..4],
        );
        return .{ .started = started, .handshake_length = response.accepted.packet_length };
    }

    fn authenticate(self: *Pair, handshake_length: u16) !Engine.AuthenticatedRequest {
        const authenticated = try self.node_b.receive(
            &self.b_to_a,
            self.a_to_b[0..handshake_length],
            self.address_a,
            receiveArgs(5, 0x60),
            &self.scratch_b,
        );
        try std.testing.expect(authenticated.accepted.event == .request);
        try std.testing.expect(authenticated.accepted.event.request.record != null);
        try std.testing.expectEqual(
            self.record_a.node_id,
            authenticated.accepted.event.request.record.?.node_id,
        );
        try std.testing.expect(self.node_b.routing.contains(&self.record_a.node_id));
        try std.testing.expectEqual(@as(usize, 1), self.node_b.channel.sessions.sessionCount());
        try std.testing.expectEqual(@as(usize, 0), self.node_b.channel.sessions.challengeCount());
        return authenticated.accepted.event.request;
    }

    fn completePong(
        self: *Pair,
        started: Engine.StartResult,
        request: *const Engine.AuthenticatedRequest,
    ) !void {
        var response: PendingResponse = .{};
        try self.node_b.prepareStandardResponse(request, &response);
        var too_small: [1]u8 = undefined;
        try std.testing.expectError(
            error.BufferTooSmall,
            self.node_b.encodeNextStandardResponse(
                &too_small,
                &response,
                6,
                &sealEntropy(0x70),
            ),
        );
        try std.testing.expect(!response.complete());
        const length = (try self.node_b.encodeNextStandardResponse(
            &self.b_to_a,
            &response,
            6,
            &sealEntropy(0x70),
        )).?;
        const response_packet = try packet.decode(
            self.b_to_a[0..length],
            &self.record_a.node_id,
            &self.scratch_a.channel.packet_decode,
        );
        try std.testing.expectEqualSlices(
            u8,
            &.{ 0, 0, 0, 1 },
            response_packet.static_header.nonce[0..4],
        );
        try std.testing.expect(response.complete());
        try std.testing.expect((try self.node_b.encodeNextStandardResponse(
            &self.b_to_a,
            &response,
            6,
            &sealEntropy(0x70),
        )) == null);
        const completed = try self.node_a.receive(
            &self.a_to_b,
            self.b_to_a[0..length],
            self.address_b,
            receiveArgs(7, 0x80),
            &self.scratch_a,
        );
        try std.testing.expect(completed.accepted.event == .response);
        try std.testing.expect(completed.accepted.event.response.matched.terminal);
        try std.testing.expectEqual(
            started.handle,
            completed.accepted.event.response.matched.handle,
        );
        const pong = completed.accepted.event.response.matched.response.pong;
        try std.testing.expectEqual(self.record_b.sequence, pong.enr_sequence);
        try std.testing.expectEqual(self.address_a.ip4.octets, pong.recipient_ip.ip4);
        try std.testing.expectEqual(self.address_a.ip4.port, pong.recipient_port);
        const peer_b = self.peerB();
        _ = try self.node_a.confirmPeer(&peer_b, &self.record_b, 7);
        try std.testing.expect(self.node_a.routing.contains(&self.record_b.node_id));

        var records: [2]enr.Record = undefined;
        const distance = types.logDistance(&self.record_a.node_id, &self.record_b.node_id);
        const selected = try self.node_a.findNodes(self.address_b, &.{ 0, distance }, &records);
        try std.testing.expectEqual(@as(usize, 2), selected.len);
        try std.testing.expectEqual(self.record_a.node_id, selected[0].node_id);
        try std.testing.expectEqual(self.record_b.node_id, selected[1].node_id);
    }

    fn ping(self: *const Pair, id: u8) message.Message {
        return .{ .ping = .{
            .request_id = message.RequestId.init(&.{id}) catch unreachable,
            .enr_sequence = self.record_a.sequence,
        } };
    }

    fn peerA(self: *const Pair) types.Endpoint {
        return .{ .node_id = self.record_a.node_id, .address = self.address_a };
    }

    fn peerB(self: *const Pair) types.Endpoint {
        return .{ .node_id = self.record_b.node_id, .address = self.address_b };
    }
};

test "engine rejects a local record owned by another key" {
    const key_a = try keyPair(0x11);
    const key_b = try keyPair(0x22);
    const record_b = try enr.Record.create(&key_b, 1, loopback(2, 9_002));
    var invalid: TestEngine = undefined;
    try std.testing.expectError(
        error.InvalidLocalRecord,
        invalid.init(std.testing.allocator, key_a, record_b, .{}),
    );
}

test "cold oversized requests fail before transmission" {
    const key = try keyPair(0x11);
    const local_record = try enr.Record.create(&key, 1, loopback(1, 9_001));
    var node: TestEngine = undefined;
    try node.init(std.testing.allocator, key, local_record, engineConfig());
    defer node.deinit(std.testing.allocator);
    const remote_key = try keyPair(0x22);
    const remote_record = try enr.Record.create(&remote_key, 1, loopback(2, 9_002));
    const peer = types.Endpoint{
        .node_id = remote_record.node_id,
        .address = loopback(2, 9_002),
    };
    const payload = [_]u8{0x55} ** 1_100;
    const request = message.Message{ .talk_request = .{
        .request_id = try message.RequestId.init(&.{0x01}),
        .protocol = &.{},
        .request = &payload,
    } };
    var output = [_]u8{0xa5} ** 1_280;
    const before = output;
    try std.testing.expectError(error.SessionRequired, node.startCall(
        &output,
        peer,
        &remote_record,
        &request,
        1,
        &sealEntropy(0x10),
    ));
    try std.testing.expectEqualSlices(u8, &before, &output);
    try std.testing.expectEqual(@as(usize, 0), node.calls.count());

    const session_key = [_]u8{0x33} ** 16;
    const active = engine_session.Session{
        .read_key = session_key,
        .write_key = session_key,
    };
    node.channel.sessions.install(peer, &active, 2);
    const started = try node.startCall(
        &output,
        peer,
        &remote_record,
        &request,
        3,
        &sealEntropy(0x20),
    );
    try std.testing.expect(started.packet_length > 1_100);
}

test "engine configuration rejects zero retention windows" {
    const key = try keyPair(0x11);
    const local_record = try enr.Record.create(&key, 1, loopback(1, 9_001));
    var node: TestEngine = undefined;
    var config = engineConfig();
    config.challenge_timeout_ms = 0;
    try std.testing.expectError(
        error.InvalidTimeout,
        node.init(std.testing.allocator, key, local_record, config),
    );
}

test "stale session recovery delivers the failed call handle" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    const payload = [_]u8{0xaa} ** 1_100;
    const request = message.Message{ .talk_request = .{
        .request_id = try message.RequestId.init(&.{1}),
        .protocol = &.{1},
        .request = &payload,
    } };
    const started = try pair.node_a.startCall(
        &pair.a_to_b,
        pair.peerB(),
        &pair.record_b,
        &request,
        1,
        &sealEntropy(10),
    );
    const challenge = try pair.node_b.receive(
        &pair.b_to_a,
        pair.a_to_b[0..started.packet_length],
        pair.address_a,
        receiveArgs(2, 20),
        &pair.scratch_b,
    );
    const result = try pair.node_a.receive(
        &pair.a_to_b,
        pair.b_to_a[0..challenge.accepted.packet_length],
        pair.address_b,
        receiveArgs(3, 30),
        &pair.scratch_a,
    );
    try std.testing.expect(result == .accepted);
    try std.testing.expect(result.accepted.event == .failed);
    try std.testing.expectEqual(started.handle, result.accepted.event.failed.handle);
    try std.testing.expectEqual(error.RequestTooLargeForHandshake, result.accepted.event.failed.reason);
    var expired: [4]CallTable.Expired = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.node_a.expire(200, &expired).calls);
    try std.testing.expect(!pair.node_a.cancelCall(started.handle));
}

test "duplicate NODES datagrams do not complete a fragmented response" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
    test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
    const request = message.Message{ .find_node = .{
        .request_id = try message.RequestId.init(&.{1}),
        .distances = &.{0},
    } };
    const started = try pair.node_a.startCall(
        &pair.a_to_b,
        pair.peerB(),
        &pair.record_b,
        &request,
        1,
        &sealEntropy(10),
    );
    const raw_records = [_][]const u8{pair.record_b.slice()};
    const response = message.Message{ .nodes = .{
        .request_id = request.find_node.request_id,
        .total = 2,
        .enrs = &raw_records,
    } };
    const length = try pair.node_b.sendResponse(
        &pair.b_to_a,
        pair.peerA(),
        &response,
        2,
        &sealEntropy(20),
    );
    const first = try pair.node_a.receive(
        &pair.a_to_b,
        pair.b_to_a[0..length],
        pair.address_b,
        receiveArgs(3, 30),
        &pair.scratch_a,
    );
    try std.testing.expect(!first.accepted.event.response.matched.terminal);
    const duplicate = try pair.node_a.receive(
        &pair.a_to_b,
        pair.b_to_a[0..length],
        pair.address_b,
        receiveArgs(4, 40),
        &pair.scratch_a,
    );
    try std.testing.expectEqual(types.RejectReason.duplicate_response, duplicate.rejected);
    try std.testing.expectEqual(@as(usize, 1), pair.node_a.calls.count());
    const last_length = try pair.node_b.sendResponse(
        &pair.b_to_a,
        pair.peerA(),
        &response,
        5,
        &sealEntropy(50),
    );
    const last = try pair.node_a.receive(
        &pair.a_to_b,
        pair.b_to_a[0..last_length],
        pair.address_b,
        receiveArgs(6, 60),
        &pair.scratch_a,
    );
    try std.testing.expectEqual(started.handle, last.accepted.event.response.matched.handle);
    try std.testing.expect(last.accepted.event.response.matched.terminal);
    try std.testing.expectEqual(@as(usize, 0), last.accepted.event.response.node_records.len);
    try std.testing.expectEqual(@as(usize, 0), pair.node_a.calls.count());
}

test "NODES excludes irrelevant identities before signature verification" {
    for ([_]enum { distance, duplicate, capacity }{ .distance, .duplicate, .capacity }) |filter| {
        var pair: Pair = undefined;
        try pair.init();
        defer pair.deinit();
        test_support.installSession(&pair.node_a, pair.peerB(), 0x55);
        test_support.installSession(&pair.node_b, pair.peerA(), 0x55);
        const distance: u16 = if (filter == .capacity) 256 else 0;
        const request: message.Message = .{ .find_node = .{ .request_id = try .init(&.{1}), .distances = &.{distance} } };
        _ = try pair.node_a.startCall(&pair.a_to_b, pair.peerB(), &pair.record_b, &request, 1, &sealEntropy(0x20));
        var records: [types.findnode_result_max]enr.Record = undefined;
        if (filter == .capacity) {
            var count: usize = 0;
            for (3..255) |scalar| {
                const key = try keyPair(@intCast(scalar));
                const record = try enr.Record.create(&key, 1, loopback(@intCast(scalar), 9000));
                if (types.logDistance(&pair.record_b.node_id, &record.node_id) != distance) continue;
                records[count] = record;
                count += 1;
                if (count == records.len) break;
            }
            try std.testing.expectEqual(records.len, count);
            for (0..3) |batch| {
                var raw: [5][]const u8 = undefined;
                for (&raw, records[batch * 5 ..][0..5]) |*bytes, *record| bytes.* = record.slice();
                const response: message.Message = .{ .nodes = .{ .request_id = request.find_node.request_id, .total = 4, .enrs = &raw } };
                const length = try pair.node_b.sendResponse(&pair.b_to_a, pair.peerA(), &response, 2, &sealEntropy(0x30));
                const received = try pair.node_a.receive(&pair.a_to_b, pair.b_to_a[0..length], pair.address_b, receiveArgs(3, 0x40), &pair.scratch_a);
                try std.testing.expect(!received.accepted.event.response.matched.terminal);
                try std.testing.expectEqual(@as(usize, 5), received.accepted.event.response.node_records.len);
            }
        }
        const valid = if (filter == .capacity) &records[records.len - 1] else &pair.record_b;
        const invalid = if (filter == .distance) &pair.record_a else valid;
        var corrupt = invalid.bytes;
        corrupt[10] ^= 1;
        const response: message.Message = .{ .nodes = .{ .request_id = request.find_node.request_id, .total = if (filter == .capacity) 4 else 1, .enrs = &.{ valid.slice(), corrupt[0..invalid.length] } } };
        var plaintext_buffer: [1_280]u8 = undefined;
        const plaintext = try response.encode(&plaintext_buffer);
        const hostile = try pair.node_b.channel.sealEstablished(&pair.b_to_a, pair.peerA(), plaintext, &sealEntropy(0x50), 4);
        const received = try pair.node_a.receive(&pair.a_to_b, pair.b_to_a[0..hostile.packet_length], pair.address_b, receiveArgs(5, 0x60), &pair.scratch_a);
        try std.testing.expect(received.accepted.event.response.matched.terminal);
        try std.testing.expectEqual(@as(usize, 1), received.accepted.event.response.node_records.len);
        try std.testing.expectEqual(valid.node_id, received.accepted.event.response.node_records[0].node_id);
        try std.testing.expectEqual(@as(usize, 0), pair.node_a.calls.count());
    }
}
