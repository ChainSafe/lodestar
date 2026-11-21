const std = @import("std");
const Channel = @import("Channel.zig");
const enr = @import("identity/enr.zig");
const support = @import("test_support.zig");
const types = @import("types.zig");
const constants = @import("wire/constants.zig");

const Datagram = struct {
    bytes: [constants.packet_size_max]u8 = undefined,
    length: u16 = 0,

    fn slice(self: *const Datagram) []const u8 {
        return self.bytes[0..self.length];
    }
};

const Pair = struct {
    nodes: [2]Channel,
    records: [2]enr.Record,
    scratch: Channel.Scratch = .{},
    challenges: [2]Channel.Whoareyou,
    handshakes: [2]Datagram = .{ .{}, .{} },
    replies: [2]Datagram = .{ .{}, .{} },

    fn init(self: *Pair) !void {
        self.* = .{ .nodes = undefined, .records = undefined, .challenges = undefined };
        for (0..2) |index| {
            const key = try support.keyPair(@intCast(0x11 + index * 0x11));
            self.records[index] = try enr.Record.create(&key, 1, support.loopback(@intCast(index + 1), @intCast(9_001 + index)));
        }
        try self.nodes[0].init(std.testing.allocator, try support.keyPair(0x11), self.records[0], support.channelConfig());
        errdefer self.nodes[0].deinit(std.testing.allocator);
        try self.nodes[1].init(std.testing.allocator, try support.keyPair(0x22), self.records[1], support.channelConfig());
        errdefer self.nodes[1].deinit(std.testing.allocator);
        for (0..2) |sender| {
            const recipient = 1 - sender;
            var cold: Datagram = .{};
            const sealed = try self.nodes[sender].seal(&cold.bytes, self.peer(recipient), "request", &support.sealEntropy(@intCast(0x10 + sender)), 1);
            const received = self.nodes[recipient].receive(cold.bytes[0..sealed.packet_length], self.peer(sender).address, 1, &self.scratch);
            try std.testing.expect(received == .unauthenticated);
            var challenge: Datagram = .{};
            challenge.length = (try self.nodes[recipient].challenge(&challenge.bytes, self.peer(sender), &received.unauthenticated.request_nonce, null, &support.challengeEntropy(@intCast(0x20 + sender)), 1)).?;
            const who = self.nodes[sender].receive(challenge.slice(), self.peer(recipient).address, 1, &self.scratch);
            try std.testing.expect(who == .whoareyou);
            self.challenges[sender] = who.whoareyou;
        }
    }

    fn deinit(self: *Pair) void {
        for (&self.nodes) |*node| node.deinit(std.testing.allocator);
    }

    fn peer(self: *const Pair, index: usize) types.Endpoint {
        return support.endpoint(&self.records[index]);
    }

    fn advance(self: *Pair, sender: usize, step: u8, now_ms: u64) !void {
        const recipient = 1 - sender;
        switch (step) {
            0 => {
                const sealed = try self.nodes[sender].answerChallenge(&self.handshakes[sender].bytes, .{
                    .peer = self.peer(recipient),
                    .remote_public_key = &self.records[recipient].public_key,
                    .plaintext = if (sender == 0) "request A" else "request B",
                    .challenge_data = &self.challenges[sender].challenge_data,
                    .enr_sequence = 0,
                    .entropy = &support.handshakeEntropy(@intCast(0x30 + sender)),
                    .now_ms = now_ms,
                });
                self.handshakes[sender].length = sealed.packet_length;
            },
            1 => {
                const received = self.nodes[recipient].receive(self.handshakes[sender].slice(), self.peer(sender).address, now_ms, &self.scratch);
                try std.testing.expect(received == .authenticated);
                try std.testing.expectEqualSlices(u8, if (sender == 0) "request A" else "request B", received.authenticated.plaintext);
                const sealed = try self.nodes[recipient].sealEstablished(&self.replies[sender].bytes, self.peer(sender), if (sender == 0) "response A" else "response B", &support.sealEntropy(@intCast(0x40 + sender)), now_ms);
                self.replies[sender].length = sealed.packet_length;
            },
            2 => {
                const received = self.nodes[sender].receive(self.replies[sender].slice(), self.peer(recipient).address, now_ms, &self.scratch);
                try std.testing.expect(received == .authenticated);
                try std.testing.expectEqualSlices(u8, if (sender == 0) "response A" else "response B", received.authenticated.plaintext);
            },
            else => unreachable,
        }
    }
};

test "crossed cold handshakes and delayed replies authenticate in every bounded ordering" {
    var schedules: usize = 0;
    for (0..4) |first| {
        for (first + 1..5) |second| {
            for (second + 1..6) |third| {
                var pair: Pair = undefined;
                try pair.init();
                defer pair.deinit();
                var steps = [_]u8{ 0, 0 };
                for (0..6) |position| {
                    const sender: usize = if (position == first or position == second or position == third) 0 else 1;
                    try pair.advance(sender, steps[sender], position + 2);
                    steps[sender] += 1;
                }
                for (0..2) |sender| {
                    const recipient = 1 - sender;
                    try std.testing.expectEqual(@as(usize, 0), pair.nodes[sender].sessions.challengeCount());
                    var ordinary: Datagram = .{};
                    const sealed = try pair.nodes[sender].sealEstablished(&ordinary.bytes, pair.peer(recipient), "still connected", &support.sealEntropy(@intCast(0x50 + sender)), 10);
                    const received = pair.nodes[recipient].receive(ordinary.bytes[0..sealed.packet_length], pair.peer(sender).address, 10, &pair.scratch);
                    try std.testing.expect(received == .authenticated);
                    try std.testing.expectEqualSlices(u8, "still connected", received.authenticated.plaintext);
                }
                schedules += 1;
            }
        }
    }
    try std.testing.expectEqual(@as(usize, 20), schedules);
}

test "invalid crossed handshake preserves both read generations and consumes its challenge" {
    var pair: Pair = undefined;
    try pair.init();
    defer pair.deinit();
    pair.nodes[1].sessions.install(pair.peer(0), &.{
        .read_key = [_]u8{0xA1} ** 16,
        .write_key = [_]u8{0xA2} ** 16,
    }, 1);
    try pair.advance(0, 0, 2);
    try pair.advance(1, 0, 3);
    const current_key = pair.nodes[1].sessions.readKey(pair.peer(0)).?;
    const alternate_key = pair.nodes[1].sessions.alternateReadKey(pair.peer(0)).?;
    pair.handshakes[0].bytes[pair.handshakes[0].length - 1] ^= 1;
    const invalid = pair.nodes[1].receive(pair.handshakes[0].slice(), pair.peer(0).address, 4, &pair.scratch);
    try std.testing.expectEqual(types.RejectReason.invalid_handshake, invalid.rejected);
    try std.testing.expectEqual(@as(usize, 0), pair.nodes[1].sessions.challengeCount());
    try std.testing.expectEqual(current_key, pair.nodes[1].sessions.readKey(pair.peer(0)).?);
    try std.testing.expectEqual(alternate_key, pair.nodes[1].sessions.alternateReadKey(pair.peer(0)).?);
    pair.handshakes[0].bytes[pair.handshakes[0].length - 1] ^= 1;
    const rejected = pair.nodes[1].receive(pair.handshakes[0].slice(), pair.peer(0).address, 5, &pair.scratch);
    try std.testing.expectEqual(types.RejectReason.unexpected_handshake, rejected.rejected);
    try pair.advance(1, 1, 7);
    try pair.advance(1, 2, 8);
    const replay = pair.nodes[0].receive(pair.handshakes[1].slice(), pair.peer(1).address, 9, &pair.scratch);
    try std.testing.expectEqual(types.RejectReason.unexpected_handshake, replay.rejected);
}

test "forged delayed packets cannot refresh either session generation" {
    for ([_]bool{ false, true }) |deliver_valid| {
        var pair: Pair = undefined;
        try pair.init();
        defer pair.deinit();
        try pair.advance(0, 0, 2);
        try pair.advance(1, 0, 3);
        try pair.advance(0, 1, 4);
        try pair.advance(1, 1, 5);
        const current_key = pair.nodes[0].sessions.readKey(pair.peer(1)).?;
        const alternate_key = pair.nodes[0].sessions.alternateReadKey(pair.peer(1)).?;
        const deadline_before = pair.nodes[0].nextDeadlineMs();
        pair.replies[0].bytes[pair.replies[0].length - 1] ^= 1;
        const forged = pair.nodes[0].receive(pair.replies[0].slice(), pair.peer(1).address, 100, &pair.scratch);
        try std.testing.expect(forged == .unauthenticated);
        try std.testing.expectEqual(deadline_before, pair.nodes[0].nextDeadlineMs());
        if (deliver_valid) {
            pair.replies[0].bytes[pair.replies[0].length - 1] ^= 1;
            try pair.advance(0, 2, 100);
        }
        const expires_ms: u64 = if (deliver_valid) 1_100 else 1_005;
        try std.testing.expectEqual(@as(usize, 0), pair.nodes[0].expire(expires_ms - 1).sessions);
        try std.testing.expectEqual(current_key, pair.nodes[0].sessions.readKey(pair.peer(1)).?);
        try std.testing.expectEqual(alternate_key, pair.nodes[0].sessions.alternateReadKey(pair.peer(1)).?);
        try std.testing.expectEqual(@as(usize, 1), pair.nodes[0].expire(expires_ms).sessions);
    }
}
