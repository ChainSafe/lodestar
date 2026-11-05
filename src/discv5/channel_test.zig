const std = @import("std");
const Channel = @import("Channel.zig");
const admission = @import("Admission.zig");
const crypto = @import("identity/crypto.zig");
const enr = @import("identity/enr.zig");
const test_support = @import("test_support.zig");
const types = @import("types.zig");
const constants = @import("wire/constants.zig");
const packet = @import("wire/packet.zig");

const challengeEntropy = test_support.challengeEntropy;
const channelConfig = test_support.channelConfig;
const handshakeEntropy = test_support.handshakeEntropy;
const keyPair = test_support.keyPair;
const loopback = test_support.loopback;
const sealEntropy = test_support.sealEntropy;

test "cold packet is challenged and the handshake delivers the sender record" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const plaintext = "ping";
    const length = try pair.challengeAndHandshake(plaintext, null, 1);
    const handshake_packet = try packet.decode(
        pair.a_to_b[0..length],
        &pair.record_b.node_id,
        &pair.scratch.packet_decode,
    );
    try std.testing.expect(handshake_packet.form.handshake.enr != null);

    const inbound = pair.node_b.receive(
        pair.a_to_b[0..length],
        pair.address_a,
        2,
        &pair.scratch,
    );
    try std.testing.expect(inbound == .authenticated);
    try std.testing.expectEqualSlices(u8, plaintext, inbound.authenticated.plaintext);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 1, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31 }, &inbound.authenticated.nonce);
    try std.testing.expectEqual(pair.record_a.node_id, inbound.authenticated.record.?.node_id);
    try std.testing.expect(pair.node_a.hasSession(pair.peerB()));
    try std.testing.expect(pair.node_b.hasSession(pair.peerA()));
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());

    const entropy = sealEntropy(0x40);
    const reply = try pair.node_b.sealEstablished(&pair.b_to_a, pair.peerA(), "pong", &entropy, 3);
    const answered = pair.node_a.receive(
        pair.b_to_a[0..reply.packet_length],
        pair.address_b,
        3,
        &pair.scratch,
    );
    try std.testing.expect(answered == .authenticated);
    try std.testing.expectEqualSlices(u8, "pong", answered.authenticated.plaintext);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 1, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42 }, &answered.authenticated.nonce);
    try std.testing.expect(answered.authenticated.record == null);
}

test "handshake omits the local record when the challenger already knows it" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const length = try pair.challengeAndHandshake("ping", pair.identityA(), 1);
    const handshake_packet = try packet.decode(
        pair.a_to_b[0..length],
        &pair.record_b.node_id,
        &pair.scratch.packet_decode,
    );
    try std.testing.expect(handshake_packet.form.handshake.enr == null);

    const inbound = pair.node_b.receive(
        pair.a_to_b[0..length],
        pair.address_a,
        2,
        &pair.scratch,
    );
    try std.testing.expect(inbound == .authenticated);
    try std.testing.expect(inbound.authenticated.record == null);
    try std.testing.expect(pair.node_b.hasSession(pair.peerA()));
}

test "handshake without a record needs an identity captured at challenge time" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const who = try pair.challenge("ping", null, 1);
    const entropy = handshakeEntropy(0x30);
    const handshake = try pair.node_a.answerChallenge(&pair.a_to_b, .{
        .peer = pair.peerB(),
        .remote_public_key = &pair.record_b.public_key,
        .plaintext = "ping",
        .challenge_data = &who.challenge_data,
        .enr_sequence = pair.record_a.sequence,
        .entropy = &entropy,
        .now_ms = 1,
    });
    const inbound = pair.node_b.receive(
        pair.a_to_b[0..handshake.packet_length],
        pair.address_a,
        2,
        &pair.scratch,
    );
    try std.testing.expectEqual(types.RejectReason.invalid_handshake, inbound.rejected);
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.sessionCount());
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());
}

test "corrupted handshake consumes its challenge and a fresh attempt can recover" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const length = try pair.challengeAndHandshake("ping", null, 1);
    pair.a_to_b[length - 1] ^= 1;
    const corrupted = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 2, &pair.scratch);
    try std.testing.expectEqual(types.RejectReason.invalid_handshake, corrupted.rejected);
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.sessionCount());
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());

    pair.a_to_b[length - 1] ^= 1;
    const inbound = pair.node_b.receive(
        pair.a_to_b[0..length],
        pair.address_a,
        3,
        &pair.scratch,
    );
    try std.testing.expectEqual(types.RejectReason.unexpected_handshake, inbound.rejected);
    const fresh = try pair.challengeAndHandshake("ping", null, 4);
    const recovered = pair.node_b.receive(pair.a_to_b[0..fresh], pair.address_a, 5, &pair.scratch);
    try std.testing.expect(recovered == .authenticated);
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());
}

test "invalid handshake proof receives only one verification attempt" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const length = try pair.challengeAndHandshake("ping", pair.identityA(), 1);
    const signature_offset = constants.masking_iv_size + constants.static_header_size + constants.handshake_authdata_head_size;
    pair.a_to_b[signature_offset] ^= 1;
    const invalid = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 2, &pair.scratch);
    try std.testing.expectEqual(types.RejectReason.invalid_handshake, invalid.rejected);
    const charged = handshakeCharge(&pair);
    pair.a_to_b[signature_offset] ^= 1;
    for (0..8) |_| {
        const replay = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 3, &pair.scratch);
        try std.testing.expectEqual(types.RejectReason.unexpected_handshake, replay.rejected);
    }
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.sessionCount());
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());
    try std.testing.expectEqual(charged, handshakeCharge(&pair));
}

/// When the source's handshake credit next replenishes; a verification attempt advances it.
fn handshakeCharge(pair: *const Pair) u64 {
    var group = pair.address_a;
    group.ip4.port = 0;
    return pair.node_b.admission.sources.get(group).?.buckets[@intFromEnum(admission.Stage.handshake)].charged_until_ms;
}

test "challenge admission shares source credit across ports and node identities" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    var peer = pair.peerA();
    const nonce = [_]u8{0x12} ** constants.nonce_size;
    const entropy = challengeEntropy(0x20);
    for (0..admission.source_quota.burst) |i| {
        peer.node_id[0] = @intCast(i);
        peer.address.ip4.port = @intCast(9_000 + i);
        try std.testing.expect((try pair.node_b.challenge(&pair.b_to_a, peer, &nonce, null, &entropy, 0)) != null);
    }
    peer.node_id[0] += 1;
    peer.address.ip4.port += 1;
    try std.testing.expectError(error.AdmissionLimited, pair.node_b.challenge(&pair.b_to_a, peer, &nonce, null, &entropy, 249));
    try std.testing.expect((try pair.node_b.challenge(&pair.b_to_a, peer, &nonce, null, &entropy, 250)) != null);
    try std.testing.expectEqual(@as(usize, channelConfig().challenge_capacity), pair.node_b.sessions.challengeCount());
}

test "throttled handshake retains its original deadline and can recover after refill" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    for (0..admission.source_quota.burst) |_|
        try std.testing.expect(pair.node_b.admission.allow(.handshake, &pair.address_a, 0));
    const length = try pair.challengeAndHandshake("ping", null, 200);
    for ([_]u64{ 200, 249 }) |now_ms| {
        const limited = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, now_ms, &pair.scratch);
        try std.testing.expectEqual(types.RejectReason.admission_limited, limited.rejected);
        try std.testing.expectEqual(@as(?u64, 300), pair.node_b.nextDeadlineMs());
        try std.testing.expectEqual(@as(usize, 1), pair.node_b.sessions.challengeCount());
        try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.sessionCount());
    }
    const recovered = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 250, &pair.scratch);
    try std.testing.expect(recovered == .authenticated);
    try std.testing.expectEqualSlices(u8, "ping", recovered.authenticated.plaintext);
}

test "throttled challenge expires without a timer tick and cannot regain verification credit" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    for (0..admission.source_quota.burst) |_|
        try std.testing.expect(pair.node_b.admission.allow(.handshake, &pair.address_a, 0));
    const length = try pair.challengeAndHandshake("ping", null, 1);
    const charged = handshakeCharge(&pair);
    const limited = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 100, &pair.scratch);
    try std.testing.expectEqual(types.RejectReason.admission_limited, limited.rejected);
    try std.testing.expectEqual(@as(?u64, 101), pair.node_b.nextDeadlineMs());
    for ([_]u64{ 101, 250 }) |now_ms| {
        const expired = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, now_ms, &pair.scratch);
        try std.testing.expectEqual(types.RejectReason.unexpected_handshake, expired.rejected);
    }
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());
    try std.testing.expectEqual(charged, handshakeCharge(&pair));
}

test "established packets work while both discovery admission stages are exhausted" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const length = try pair.challengeAndHandshake("ping", null, 1);
    const inbound = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 2, &pair.scratch);
    try std.testing.expect(inbound == .authenticated);
    for (0..admission.source_quota.burst - 1) |_| {
        try std.testing.expect(pair.node_b.admission.allow(.challenge, &pair.address_a, 2));
        try std.testing.expect(pair.node_b.admission.allow(.handshake, &pair.address_a, 2));
    }
    try std.testing.expect(!pair.node_b.admission.allow(.challenge, &pair.address_a, 3));
    try std.testing.expect(!pair.node_b.admission.allow(.handshake, &pair.address_a, 3));
    const sealed = try pair.node_a.sealEstablished(&pair.a_to_b, pair.peerB(), "still connected", &sealEntropy(0x40), 4);
    const received = pair.node_b.receive(pair.a_to_b[0..sealed.packet_length], pair.address_a, 4, &pair.scratch);
    try std.testing.expect(received == .authenticated);
    try std.testing.expectEqualSlices(u8, "still connected", received.authenticated.plaintext);
}

test "a pending challenge is not reissued for the same peer" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const entropy = sealEntropy(0x10);
    const sealed = try pair.node_a.seal(&pair.a_to_b, pair.peerB(), "ping", &entropy, 1);
    const inbound = pair.node_b.receive(
        pair.a_to_b[0..sealed.packet_length],
        pair.address_a,
        1,
        &pair.scratch,
    );
    const unauthenticated = inbound.unauthenticated;
    const challenge_entropy = challengeEntropy(0x20);
    try std.testing.expect((try pair.node_b.challenge(
        &pair.b_to_a,
        unauthenticated.peer,
        &unauthenticated.request_nonce,
        null,
        &challenge_entropy,
        1,
    )) != null);
    try std.testing.expect((try pair.node_b.challenge(
        &pair.b_to_a,
        unauthenticated.peer,
        &unauthenticated.request_nonce,
        null,
        &challenge_entropy,
        2,
    )) == null);
    try std.testing.expectEqual(@as(usize, 1), pair.node_b.sessions.challengeCount());
}

test "handshake rejects a request that cannot fit beside the local record" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const plaintext = [_]u8{0x55} ** 1_100;
    const who = try pair.challenge(&plaintext, null, 1);
    const entropy = handshakeEntropy(0x30);
    try std.testing.expectError(
        error.RequestTooLargeForHandshake,
        pair.node_a.answerChallenge(
            &pair.a_to_b,
            .{
                .peer = pair.peerB(),
                .remote_public_key = &pair.record_b.public_key,
                .plaintext = &plaintext,
                .challenge_data = &who.challenge_data,
                .enr_sequence = who.enr_sequence,
                .entropy = &entropy,
                .now_ms = 1,
            },
        ),
    );
    try std.testing.expect(!pair.node_a.hasSession(pair.peerB()));
}

test "established seal requires a session" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    const entropy = sealEntropy(0x10);
    try std.testing.expectError(
        error.MissingSession,
        pair.node_a.sealEstablished(&pair.a_to_b, pair.peerB(), "ping", &entropy, 1),
    );
}

test "expire removes stale challenges and idle sessions" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();

    _ = try pair.challenge("ping", null, 1);
    try std.testing.expectEqual(@as(usize, 1), pair.node_b.sessions.challengeCount());
    const challenges = pair.node_b.expire(1 + channelConfig().challenge_timeout_ms);
    try std.testing.expectEqual(@as(usize, 1), challenges.challenges);
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());

    const length = try pair.challengeAndHandshake("ping", null, 200);
    _ = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 200, &pair.scratch);
    try std.testing.expect(pair.node_b.hasSession(pair.peerA()));
    const sessions = pair.node_b.expire(200 + channelConfig().session_idle_timeout_ms);
    try std.testing.expectEqual(@as(usize, 1), sessions.sessions);
    try std.testing.expect(!pair.node_b.hasSession(pair.peerA()));
}

test "channel rejects a foreign local record and zero timeouts" {
    const key_a = try keyPair(0x11);
    const key_b = try keyPair(0x22);
    const record_b = try enr.Record.create(&key_b, 1, loopback(2, 9_002));
    var invalid: Channel = undefined;
    try std.testing.expectError(
        error.InvalidLocalRecord,
        invalid.init(std.testing.allocator, key_a, record_b, channelConfig()),
    );
    var config = channelConfig();
    config.session_idle_timeout_ms = 0;
    try std.testing.expectError(
        error.InvalidTimeout,
        invalid.init(std.testing.allocator, key_b, record_b, config),
    );
}

test "channel initialization releases every partially allocated resource" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocateChannel, .{});
}

fn allocateChannel(allocator: std.mem.Allocator) !void {
    const key = try keyPair(0x11);
    const record = try enr.Record.create(&key, 1, loopback(1, 9_001));
    var channel: Channel = undefined;
    try channel.init(allocator, key, record, channelConfig());
    defer channel.deinit(allocator);
}

const Pair = struct {
    address_a: types.Address,
    address_b: types.Address,
    record_a: enr.Record,
    record_b: enr.Record,
    node_a: Channel,
    node_b: Channel,
    scratch: Channel.Scratch,
    a_to_b: [constants.packet_size_max]u8,
    b_to_a: [constants.packet_size_max]u8,

    fn init(self: *Pair) !void {
        try self.initSequence(1);
    }

    fn initSequence(self: *Pair, sequence: u64) !void {
        self.address_a = loopback(1, 9_001);
        self.address_b = loopback(2, 9_002);
        const key_a = try keyPair(0x11);
        const key_b = try keyPair(0x22);
        self.record_a = try enr.Record.create(&key_a, sequence, self.address_a);
        self.record_b = try enr.Record.create(&key_b, 1, self.address_b);
        try self.node_a.init(std.testing.allocator, key_a, self.record_a, channelConfig());
        errdefer self.node_a.deinit(std.testing.allocator);
        try self.node_b.init(std.testing.allocator, key_b, self.record_b, channelConfig());
        self.scratch = .{};
    }

    fn deinit(self: *Pair) void {
        self.node_b.deinit(std.testing.allocator);
        self.node_a.deinit(std.testing.allocator);
    }

    fn peerA(self: *const Pair) types.Endpoint {
        return .{ .node_id = self.record_a.node_id, .address = self.address_a };
    }

    fn peerB(self: *const Pair) types.Endpoint {
        return .{ .node_id = self.record_b.node_id, .address = self.address_b };
    }

    fn identityA(self: *const Pair) Channel.KnownIdentity {
        return .{ .sequence = self.record_a.sequence, .public_key = self.record_a.public_key };
    }

    /// A sends a cold packet and B challenges it. Returns the WHOAREYOU as A decoded it.
    fn challenge(
        self: *Pair,
        plaintext: []const u8,
        known: ?Channel.KnownIdentity,
        now_ms: u64,
    ) !Channel.Whoareyou {
        const seal_entropy = sealEntropy(0x10);
        const sealed = try self.node_a.seal(
            &self.a_to_b,
            self.peerB(),
            plaintext,
            &seal_entropy,
            now_ms,
        );
        const inbound = self.node_b.receive(
            self.a_to_b[0..sealed.packet_length],
            self.address_a,
            now_ms,
            &self.scratch,
        );
        try std.testing.expect(inbound == .unauthenticated);
        try std.testing.expectEqual(sealed.nonce, inbound.unauthenticated.request_nonce);
        const challenge_entropy = challengeEntropy(0x20);
        const length = (try self.node_b.challenge(
            &self.b_to_a,
            inbound.unauthenticated.peer,
            &inbound.unauthenticated.request_nonce,
            known,
            &challenge_entropy,
            now_ms,
        )).?;
        try std.testing.expectEqual(@as(u16, constants.whoareyou_packet_size), length);
        const who = self.node_a.receive(
            self.b_to_a[0..length],
            self.address_b,
            now_ms,
            &self.scratch,
        );
        try std.testing.expect(who == .whoareyou);
        try std.testing.expectEqual(sealed.nonce, who.whoareyou.request_nonce);
        return who.whoareyou;
    }

    /// Runs `challenge` and answers it. Returns the handshake packet length in `a_to_b`.
    fn challengeAndHandshake(
        self: *Pair,
        plaintext: []const u8,
        known: ?Channel.KnownIdentity,
        now_ms: u64,
    ) !u16 {
        const who = try self.challenge(plaintext, known, now_ms);
        const entropy = handshakeEntropy(0x30);
        const handshake = try self.node_a.answerChallenge(&self.a_to_b, .{
            .peer = self.peerB(),
            .remote_public_key = &self.record_b.public_key,
            .plaintext = plaintext,
            .challenge_data = &who.challenge_data,
            .enr_sequence = who.enr_sequence,
            .entropy = &entropy,
            .now_ms = now_ms,
        });
        try std.testing.expectEqual(Channel.handshakeNonce(&entropy), handshake.nonce);
        return handshake.packet_length;
    }
};

test "channel exposes the next challenge or idle session deadline" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    try std.testing.expect(pair.node_b.nextDeadlineMs() == null);
    _ = try pair.challenge("ping", null, 1);
    try std.testing.expectEqual(@as(?u64, 101), pair.node_b.nextDeadlineMs());
    _ = pair.node_b.expire(101);
    try std.testing.expect(pair.node_b.nextDeadlineMs() == null);
    const length = try pair.challengeAndHandshake("ping", null, 200);
    _ = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 200, &pair.scratch);
    try std.testing.expectEqual(@as(?u64, 1_200), pair.node_b.nextDeadlineMs());
    _ = try pair.node_b.sealEstablished(&pair.b_to_a, pair.peerA(), "pong", &sealEntropy(0x50), 300);
    try std.testing.expectEqual(@as(?u64, 1_200), pair.node_b.nextDeadlineMs());
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.expire(1_200).sessions);
    try std.testing.expectEqual(@as(?u64, 1_300), pair.node_b.nextDeadlineMs());
    try std.testing.expectEqual(@as(usize, 0), pair.node_b.expire(1_299).sessions);
    try std.testing.expectEqual(@as(usize, 1), pair.node_b.expire(1_300).sessions);
    try std.testing.expect(pair.node_b.nextDeadlineMs() == null);
}

test "local record updates require a newer authenticated value from the local key" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    const updated = try enr.Record.create(&try keyPair(0x11), 2, loopback(3, 9_003));
    try pair.node_a.updateLocalRecord(&updated);
    try std.testing.expectEqualSlices(u8, updated.slice(), pair.node_a.local_record.slice());
    try std.testing.expectError(error.StaleLocalRecord, pair.node_a.updateLocalRecord(&pair.record_a));
    try std.testing.expectError(error.StaleLocalRecord, pair.node_a.updateLocalRecord(&updated));
    try std.testing.expectError(error.InvalidLocalRecord, pair.node_a.updateLocalRecord(&pair.record_b));
    var corrupted = try enr.Record.create(&try keyPair(0x11), 3, pair.address_a);
    corrupted.bytes[10] ^= 1;
    try std.testing.expectError(error.InvalidSignature, enr.Record.init(corrupted.slice()));
    corrupted.length = constants.enr_size_max + 1;
    try std.testing.expectError(error.InvalidLocalRecord, pair.node_a.updateLocalRecord(&corrupted));
    try std.testing.expectEqualSlices(u8, updated.slice(), pair.node_a.local_record.slice());

    const length = try pair.challengeAndHandshake("ping", pair.identityA(), 1);
    const inbound = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 2, &pair.scratch);
    try std.testing.expect(inbound == .authenticated);
    try std.testing.expectEqual(@as(u64, 2), inbound.authenticated.record.?.sequence);
    try std.testing.expectEqual(updated.endpoint(), inbound.authenticated.record.?.endpoint());
}

test "sequence zero handshake includes identity for unknown and known zero challengers" {
    for ([_]bool{ false, true }) |known| {
        var pair: Pair = undefined;
        try pair.initSequence(0);
        defer pair.deinit();
        const length = try pair.challengeAndHandshake("ping", if (known) pair.identityA() else null, 1);
        const decoded = try packet.decode(pair.a_to_b[0..length], &pair.record_b.node_id, &pair.scratch.packet_decode);
        const record = try enr.Record.init(decoded.form.handshake.enr.?);
        try std.testing.expectEqual(@as(u64, 0), record.sequence);
        const inbound = pair.node_b.receive(pair.a_to_b[0..length], pair.address_a, 2, &pair.scratch);
        try std.testing.expect(inbound == .authenticated);
        try std.testing.expectEqualStrings("ping", inbound.authenticated.plaintext);
        try std.testing.expect(pair.node_b.hasSession(pair.peerA()));
        try std.testing.expectEqual(!known, inbound.authenticated.record != null);
    }
}

test "stale handshake ENR still requires a valid signature before known identity fallback" {
    for ([_]bool{ false, true }) |corrupt| {
        var pair: Pair = undefined;
        try pair.init();
        defer pair.deinit();
        var known = pair.identityA();
        known.sequence += 1;
        const who = try pair.challenge("ping", known, 1);
        // Construct a hostile sender's packet with a stale, optionally invalid ENR.
        if (corrupt) pair.node_a.local_record.bytes[10] ^= 1;
        const sealed = try pair.node_a.answerChallenge(&pair.a_to_b, .{
            .peer = pair.peerB(),
            .remote_public_key = &pair.record_b.public_key,
            .plaintext = "ping",
            .challenge_data = &who.challenge_data,
            .enr_sequence = 0,
            .entropy = &handshakeEntropy(0x30),
            .now_ms = 1,
        });
        const inbound = pair.node_b.receive(pair.a_to_b[0..sealed.packet_length], pair.address_a, 2, &pair.scratch);
        if (corrupt) {
            try std.testing.expectEqual(types.RejectReason.invalid_record, inbound.rejected);
            try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.sessionCount());
        } else {
            try std.testing.expect(inbound == .authenticated);
            try std.testing.expect(inbound.authenticated.record == null);
        }
        try std.testing.expectEqual(@as(usize, 0), pair.node_b.sessions.challengeCount());
    }
}
