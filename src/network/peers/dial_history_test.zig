const std = @import("std");
const history = @import("dial_history.zig");
const t = @import("types.zig");

const peer: t.PeerId = .{ .bytes = @splat(3) };
const other: t.PeerId = .{ .bytes = @splat(4) };
const endpoint: t.Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 9001 } };
const moved: t.Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 9002 } };

fn fixture(entries: []history.Entry) history.History {
    @memset(entries, .{});
    return .{ .entries = entries, .seed = 7 };
}

test "dial history keys separate peers endpoints and identities" {
    var storage: [64]history.Entry = undefined;
    const h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    try std.testing.expectEqual(key, h.endpointKey(&peer, endpoint));
    try std.testing.expect(key != h.endpointKey(&other, endpoint));
    try std.testing.expect(key != h.endpointKey(&peer, moved));
    try std.testing.expect(key != h.identityKey(&peer));
    try std.testing.expect(key != 0 and h.identityKey(&peer) != 0);
}

test "dial history blocks an endpoint after two strikes until its memory expires" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    h.recordEndpoint(key, .unanswered, 5, 0);
    try std.testing.expect(!h.blocked(key, 5, 1));
    try std.testing.expectEqual(@as(u8, 1), h.strikesFor(key, 5, 1));
    h.recordEndpoint(key, .handshake_timeout, 5, 1);
    h.markRetry(key, .handshake_timeout, 1);
    try std.testing.expect(h.blocked(key, 5, 2));
    try std.testing.expect(h.blocked(key, 4, 2));
    try std.testing.expect(!h.blocked(key, 6, 2));
    try std.testing.expectEqual(@as(u8, 0), h.strikesFor(key, 6, 2));
    try std.testing.expectEqual(@as(?t.DialFailure, .handshake_timeout), h.takeRetry(key, 2));
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(key, 2));
    try std.testing.expect(!h.blocked(key, 5, 1 + history.endpoint_memory_ms));
    try std.testing.expectEqual(@as(u8, 0), h.strikesFor(key, 5, 1 + history.endpoint_memory_ms));
}

test "dial history mismatch blocks every sequence for its longer window" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    h.recordEndpoint(key, .peer_id_mismatch, 5, 0);
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(key, 1));
    try std.testing.expect(h.blocked(key, 99, history.endpoint_memory_ms));
    try std.testing.expect(!h.blocked(key, 99, history.mismatch_memory_ms));
}

test "dial history clear forgets a proven endpoint" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    h.recordEndpoint(key, .refused, 1, 0);
    h.recordEndpoint(key, .refused, 1, 1);
    try std.testing.expect(h.blocked(key, 1, 2));
    h.clearFailures(key);
    try std.testing.expect(!h.blocked(key, 1, 2));
    try std.testing.expectEqual(@as(u8, 0), h.strikesFor(key, 1, 2));
}

test "dial history health strikes outlast cleared dial failures and a newer sequence" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    h.recordEndpoint(key, .unanswered, 5, 0);
    h.recordEndpoint(key, .health, 5, 1);
    try std.testing.expect(h.blocked(key, 5, 2));
    h.clearFailures(key);
    try std.testing.expect(!h.blocked(key, 5, 2));
    try std.testing.expectEqual(@as(u8, 1), h.strikesFor(key, 5, 2));
    try std.testing.expectEqual(@as(u8, 1), h.strikesFor(key, 6, 2));
    h.recordEndpoint(key, .health, 5, 3);
    try std.testing.expect(h.blocked(key, 5, 4));
    try std.testing.expect(h.blocked(key, 99, 4));
    try std.testing.expectEqual(@as(u8, 2), h.strikesFor(key, 99, 4));
    h.clearFailures(key);
    try std.testing.expect(h.blocked(key, 99, 4));
    try std.testing.expect(!h.blocked(key, 99, 3 + history.endpoint_memory_ms));
    try std.testing.expectEqual(@as(u8, 0), h.strikesFor(key, 5, 3 + history.endpoint_memory_ms));
}

test "dial history clearing health keeps dial failures and a mismatch block" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    h.recordEndpoint(key, .health, 1, 0);
    h.markRetry(key, .health, 0);
    h.clearHealth(key);
    try std.testing.expectEqual(@as(u8, 0), h.strikesFor(key, 1, 1));
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(key, 1));
    h.recordEndpoint(key, .health, 1, 1);
    h.recordEndpoint(key, .unanswered, 1, 2);
    try std.testing.expect(h.blocked(key, 1, 3));
    h.clearHealth(key);
    try std.testing.expect(!h.blocked(key, 1, 3));
    try std.testing.expectEqual(@as(u8, 1), h.strikesFor(key, 1, 3));
    h.recordEndpoint(key, .health, 1, 3);
    h.recordEndpoint(key, .peer_id_mismatch, 1, 4);
    h.clearHealth(key);
    try std.testing.expect(h.blocked(key, 99, 5));
    try std.testing.expectEqual(history.strikes_to_block, h.strikesFor(key, 1, 5));
}

test "dial history escalates too many peers blocks and forgets them after the memory window" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.identityKey(&peer);
    try std.testing.expectEqual(@as(u64, 300_000), h.reject(key, .too_many_peers, 0));
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(key, 0));
    try std.testing.expectEqual(@as(?t.Rejection, .too_many_peers), h.rejection(key, 299_999));
    try std.testing.expectEqual(@as(?t.Rejection, null), h.rejection(key, 300_000));
    try std.testing.expectEqual(@as(u64, 900_000), h.reject(key, .too_many_peers, 300_000));
    try std.testing.expectEqual(@as(?t.Rejection, .too_many_peers), h.rejection(key, 1_199_999));
    try std.testing.expectEqual(@as(u64, 3_600_000), h.reject(key, .too_many_peers, 1_200_000));
    try std.testing.expectEqual(@as(?t.Rejection, .too_many_peers), h.rejection(key, 4_799_999));
    try std.testing.expectEqual(@as(u64, 3_600_000), h.reject(key, .too_many_peers, 4_800_000));
    const forgotten = 4_800_000 + history.rejection_memory_ms;
    try std.testing.expectEqual(@as(?t.Rejection, null), h.rejection(key, forgotten));
    try std.testing.expectEqual(@as(u64, 300_000), h.reject(key, .too_many_peers, forgotten));
}

test "dial history starts each rejection at its first block and adds no strike for a shutdown" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.identityKey(&peer);
    try std.testing.expectEqual(@as(u64, 60_000), h.reject(key, .shutdown, 0));
    try std.testing.expectEqual(@as(?t.Rejection, .shutdown), h.rejection(key, 59_999));
    try std.testing.expectEqual(@as(u64, 600_000), h.reject(key, .banned, 60_000));
    try std.testing.expectEqual(@as(u64, 900_000), h.reject(key, .early_close, 660_000));
    try std.testing.expectEqual(@as(u64, 60_000), h.reject(key, .shutdown, 700_000));
    try std.testing.expectEqual(@as(?t.Rejection, .early_close), h.rejection(key, 1_559_999));
    try std.testing.expectEqual(@as(u64, 60_000), h.reject(key, .shutdown, 1_560_000));
    try std.testing.expectEqual(@as(u64, 3_600_000), h.reject(key, .fault, 1_620_000));
    h.clearRejections(key);
    try std.testing.expectEqual(@as(?t.Rejection, null), h.rejection(key, 1_620_000));
    try std.testing.expectEqual(@as(u64, 60_000), h.reject(key, .early_close, 1_620_000));
}

test "dial history stays within its table and keeps the newest entry" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    for (0..1_000) |index| {
        var identity = peer;
        std.mem.writeInt(u32, identity.bytes[0..4], @intCast(index), .little);
        h.recordEndpoint(h.endpointKey(&identity, endpoint), .unanswered, 1, index);
    }
    var newest = peer;
    std.mem.writeInt(u32, newest.bytes[0..4], 999, .little);
    try std.testing.expectEqual(@as(u8, 1), h.strikesFor(h.endpointKey(&newest, endpoint), 1, 1_000));
    try std.testing.expectEqual(@as(usize, 64), history.History.capacityFor(0));
    try std.testing.expectEqual(@as(usize, 2_048), history.History.capacityFor(256));
    try std.testing.expectEqual(@as(usize, 8_192), history.History.capacityFor(4_096));
}

test "dial history holds a flood of distinct rejecting identities within its table" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const flood = 1_000;
    for (0..flood) |index| {
        var identity = peer;
        std.mem.writeInt(u32, identity.bytes[0..4], @intCast(index), .little);
        _ = h.reject(h.identityKey(&identity), .too_many_peers, index);
    }
    var blocked: usize = 0;
    for (0..flood) |index| {
        var identity = peer;
        std.mem.writeInt(u32, identity.bytes[0..4], @intCast(index), .little);
        if (h.rejection(h.identityKey(&identity), flood) != null) blocked += 1;
    }
    try std.testing.expect(blocked <= storage.len);
    var newest = peer;
    std.mem.writeInt(u32, newest.bytes[0..4], flood - 1, .little);
    try std.testing.expectEqual(@as(?t.Rejection, .too_many_peers), h.rejection(h.identityKey(&newest), flood));
}

test "dial history marks a redial per endpoint without adding evidence" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const key = h.endpointKey(&peer, endpoint);
    const other_key = h.endpointKey(&peer, moved);
    h.markRetry(key, .peer_id_mismatch, 0);
    try std.testing.expect(!h.blocked(key, 1, 1));
    try std.testing.expectEqual(@as(u8, 0), h.strikesFor(key, 0, 1));
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(other_key, 1));
    try std.testing.expectEqual(@as(?t.DialFailure, .peer_id_mismatch), h.takeRetry(key, 1));
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(key, 1));
    h.markRetry(key, .expired, 1);
    try std.testing.expectEqual(@as(?t.DialFailure, .expired), h.takeRetry(key, history.endpoint_memory_ms - 1));
    h.markRetry(key, .unanswered, history.endpoint_memory_ms - 1);
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(key, history.endpoint_memory_ms));
}

test "dial history isolates failures retries and clearing across IPv6 interfaces" {
    var storage: [64]history.Entry = undefined;
    var h = fixture(&storage);
    const scoped: t.Address = .{ .ip6 = .{ .octets = .{ 0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 9001, .interface = 1 } };
    var alternate = scoped;
    alternate.ip6.interface = 2;
    const key = h.endpointKey(&peer, scoped);
    const alternate_key = h.endpointKey(&peer, alternate);
    h.recordEndpoint(key, .peer_id_mismatch, 1, 0);
    h.markRetry(key, .peer_id_mismatch, 0);
    try std.testing.expect(!h.blocked(alternate_key, 1, 1));
    try std.testing.expectEqual(@as(?t.DialFailure, null), h.takeRetry(alternate_key, 1));
    h.clearFailures(alternate_key);
    try std.testing.expect(h.blocked(key, 1, 1));
    try std.testing.expectEqual(@as(?t.DialFailure, .peer_id_mismatch), h.takeRetry(key, 1));
    h.recordEndpoint(alternate_key, .refused, 1, 1);
    h.clearFailures(key);
    try std.testing.expect(!h.blocked(key, 1, 2));
    try std.testing.expectEqual(@as(u8, 1), h.strikesFor(alternate_key, 1, 2));
}
