const std = @import("std");
const SessionStore = @import("SessionStore.zig");
const types = @import("types.zig");
const test_support = @import("test_support.zig");

const fakeEndpoint = test_support.fakeEndpoint;

test "session table keeps key direction and bounded nonces" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 2, 2);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const read_key = [_]u8{0x11} ** 16;
    const write_key = [_]u8{0x22} ** 16;
    const active = SessionStore.Session{ .read_key = read_key, .write_key = write_key };
    table.install(peer, &active, 1);

    try std.testing.expectEqual(read_key, table.readKey(peer).?);
    try std.testing.expect(table.touch(peer, 2));
    const first = (try table.outbound(peer, &([_]u8{0x33} ** 8), 3)).?;
    try std.testing.expectEqual(write_key, first.write_key);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 1 }, first.nonce[0..4]);
    try std.testing.expectEqualSlices(u8, &([_]u8{0x33} ** 8), first.nonce[4..]);
    const second = (try table.outbound(peer, &([_]u8{0x44} ** 8), 4)).?;
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 2 }, second.nonce[0..4]);
}

test "session table rejects zero and excessive configured capacities" {
    var table: SessionStore = undefined;
    try std.testing.expectError(
        error.InvalidCapacity,
        table.init(std.testing.allocator, 0, 1),
    );
    try std.testing.expectError(
        error.InvalidCapacity,
        table.init(std.testing.allocator, SessionStore.session_capacity_max + 1, 1),
    );
    try std.testing.expectError(
        error.InvalidCapacity,
        table.init(std.testing.allocator, 1, SessionStore.challenge_capacity_max + 1),
    );
}

test "nonce exhaustion retires the unusable session" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 1, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const key = [_]u8{0x11} ** 16;
    const active = SessionStore.Session{
        .read_key = key,
        .write_key = key,
        .nonce_counter = std.math.maxInt(u32),
    };
    table.install(peer, &active, 1);
    try std.testing.expectError(
        error.NonceExhausted,
        table.outbound(peer, &([_]u8{0x22} ** 8), 2),
    );
    try std.testing.expectEqual(@as(usize, 0), table.sessionCount());
    try std.testing.expect((try table.outbound(peer, &([_]u8{0x22} ** 8), 3)) == null);
}

test "challenge churn preserves established sessions" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 1, 2);
    defer table.deinit(std.testing.allocator);
    const established = fakeEndpoint(1, 9_001);
    const key = [_]u8{0x11} ** 16;
    const active = SessionStore.Session{ .read_key = key, .write_key = key };
    table.install(established, &active, 1);
    const challenge = [_]u8{0x55} ** 63;
    try std.testing.expect(table.putChallenge(fakeEndpoint(2, 9_002), &challenge, null, 2));
    try std.testing.expect(table.putChallenge(fakeEndpoint(3, 9_003), &challenge, null, 3));
    try std.testing.expect(table.putChallenge(fakeEndpoint(4, 9_004), &challenge, null, 4));

    try std.testing.expectEqual(@as(usize, 1), table.sessionCount());
    try std.testing.expectEqual(key, table.readKey(established).?);
    try std.testing.expect(table.getChallenge(fakeEndpoint(2, 9_002)) == null);
    try std.testing.expect(table.getChallenge(fakeEndpoint(3, 9_003)) != null);
    try std.testing.expect(table.getChallenge(fakeEndpoint(4, 9_004)) != null);
}

test "install preserves a challenge until explicit consumption" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 2, 2);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const challenge = [_]u8{0x55} ** 63;
    try std.testing.expect(table.putChallenge(peer, &challenge, null, 10));
    var replacement = challenge;
    replacement[0] = 0x66;
    try std.testing.expect(!table.putChallenge(peer, &replacement, null, 11));
    try std.testing.expectEqual(challenge, table.getChallenge(peer).?.data);
    try std.testing.expectEqual(@as(usize, 0), table.expireChallenges(19, 10));
    const key = [_]u8{0x11} ** 16;
    const active = SessionStore.Session{ .read_key = key, .write_key = key };
    table.install(peer, &active, 20);
    try std.testing.expectEqual(@as(usize, 1), table.challengeCount());
    table.removeChallenge(peer);
    try std.testing.expectEqual(@as(usize, 0), table.challengeCount());

    try std.testing.expect(table.putChallenge(fakeEndpoint(2, 9_002), &challenge, null, 30));
    try std.testing.expectEqual(@as(usize, 1), table.expireChallenges(40, 10));
    try std.testing.expectEqual(@as(usize, 0), table.challengeCount());
    try std.testing.expectEqual(@as(usize, 1), table.sessionCount());
}

test "idle session expiration is independent from challenges" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 1, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const key = [_]u8{0x11} ** 16;
    const active = SessionStore.Session{ .read_key = key, .write_key = key };
    table.install(peer, &active, 10);
    const challenge = [_]u8{0x55} ** 63;
    try std.testing.expect(table.putChallenge(fakeEndpoint(2, 9_002), &challenge, null, 15));
    try std.testing.expectEqual(key, table.readKey(peer).?);
    try std.testing.expectEqual(@as(usize, 1), table.expireSessions(20, 10));
    try std.testing.expectEqual(@as(usize, 0), table.sessionCount());
    try std.testing.expectEqual(@as(usize, 1), table.challengeCount());
}

test "reinstalling the same key cannot reset the outbound nonce counter" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 1, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const active = SessionStore.Session{
        .read_key = [_]u8{0x11} ** 16,
        .write_key = [_]u8{0x22} ** 16,
    };
    table.install(peer, &active, 1);
    const tail = [_]u8{0x33} ** 8;
    _ = (try table.outbound(peer, &tail, 2)).?;
    table.install(peer, &active, 3);
    const outbound = (try table.outbound(peer, &tail, 4)).?;
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 2 }, outbound.nonce[0..4]);
}

test "session transitions retain only the previous distinct read key" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 1, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const first = SessionStore.Session{ .read_key = [_]u8{0x11} ** 16, .write_key = [_]u8{0x21} ** 16 };
    const second = SessionStore.Session{ .read_key = [_]u8{0x12} ** 16, .write_key = [_]u8{0x22} ** 16 };
    const third = SessionStore.Session{ .read_key = [_]u8{0x13} ** 16, .write_key = [_]u8{0x23} ** 16 };
    table.install(peer, &first, 1);
    try std.testing.expect(table.alternateReadKey(peer) == null);
    table.install(peer, &second, 2);
    try std.testing.expectEqual(first.read_key, table.alternateReadKey(peer).?);
    table.install(peer, &second, 3);
    try std.testing.expectEqual(first.read_key, table.alternateReadKey(peer).?);
    table.install(peer, &third, 4);
    try std.testing.expectEqual(third.read_key, table.readKey(peer).?);
    try std.testing.expectEqual(second.read_key, table.alternateReadKey(peer).?);
    try std.testing.expectEqual(@as(usize, 1), table.expireSessions(14, 10));
    try std.testing.expect(table.readKey(peer) == null);
    try std.testing.expect(table.alternateReadKey(peer) == null);
    table.install(peer, &first, 15);
    try std.testing.expect(table.alternateReadKey(peer) == null);
}

test "next deadline chooses pending work and saturates at the clock limit" {
    var table: SessionStore = undefined;
    try table.init(std.testing.allocator, 1, 1);
    defer table.deinit(std.testing.allocator);
    const peer = fakeEndpoint(1, 9_001);
    const active = SessionStore.Session{ .read_key = [_]u8{0x11} ** 16, .write_key = [_]u8{0x22} ** 16 };
    table.install(peer, &active, 40);
    try std.testing.expect(table.putChallenge(fakeEndpoint(2, 9_002), &([_]u8{0x55} ** 63), null, 10));
    try std.testing.expectEqual(@as(?u64, 30), table.nextDeadlineMs(20, 100));
    try std.testing.expectEqual(@as(usize, 1), table.expireChallenges(30, 20));
    try std.testing.expectEqual(@as(?u64, 140), table.nextDeadlineMs(20, 100));
    const last = std.math.maxInt(u64);
    try std.testing.expect(table.touch(peer, last - 5));
    try std.testing.expectEqual(@as(?u64, 140), table.nextDeadlineMs(20, 100));
    try std.testing.expectEqual(@as(usize, 0), table.expireSessions(last - 1, 100));
    try std.testing.expectEqual(@as(?u64, last), table.nextDeadlineMs(20, 100));
    try std.testing.expectEqual(@as(usize, 1), table.expireSessions(last, 100));
    try std.testing.expect(table.nextDeadlineMs(20, 100) == null);
}
