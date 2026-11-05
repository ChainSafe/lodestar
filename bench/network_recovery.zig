//! The recovery_resolve case: the cost of one gossip recovery resolve against the number of
//! outstanding IWANT requests, from empty to promises_cap. Requests arrive in batches of
//! `batch_ids` random ids from one peer. A miss resolves an id never requested, as for most
//! received messages; a hit resolves every id of one batch, the last emptying it, and the batch is
//! then requested again untimed.
const std = @import("std");
const network = @import("network");
const preset = @import("preset");

const Recovery = network.gossipsub.recovery.Recovery;
const PeerBook = @FieldType(network.gossipsub.Gossipsub, "peers");
const MessageId = network.gossipsub.Gossipsub.MessageId;
const promises_cap = network.gossipsub.constants.promises_cap;
const batch_ids = 32;
const levels = [_]usize{ 0, 32, 128, 512, 1024, 2048, 4096, promises_cap };
const miss_calls = 20_000;
const hit_rounds = 256;
const assert = std.debug.assert;

comptime {
    assert(promises_cap % batch_ids == 0);
}

fn perCall(ns: u64, calls: usize) f64 {
    return @as(f64, @floatFromInt(ns)) / @as(f64, @floatFromInt(calls));
}

fn timestamp(io: std.Io) u64 {
    return @intCast(std.Io.Clock.awake.now(io).nanoseconds);
}

pub fn run(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    std.debug.print("case=recovery_resolve preset={s} optimize={s} promises_cap={} batch_ids={} backing_bytes={} miss_calls={} hit_calls={}\n", .{ @tagName(preset.active_preset), @tagName(@import("builtin").mode), promises_cap, batch_ids, Recovery.backingBytes(), miss_calls, hit_rounds * batch_ids });
    var peers = try PeerBook.init(allocator, &.{ .retained_score_ms = 10_000, .connected_capacity = 1, .retained_capacity = 3, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(allocator);
    const connection: network.Handle = .{ .index = 0, .generation = 1 };
    const peer = peers.admit(connection, &.{ .identity = .{ .bytes = @splat(1) }, .address = .unspecified, .direction = .inbound }, 0).admitted.peer;
    var recovery = try Recovery.init(allocator);
    defer recovery.deinit(allocator, &peers);

    const requested = try allocator.alloc(MessageId, promises_cap);
    defer allocator.free(requested);
    const misses = try allocator.alloc(MessageId, 4096);
    defer allocator.free(misses);
    var prng: std.Random.DefaultPrng = .init(1);
    prng.random().bytes(std.mem.sliceAsBytes(requested));
    prng.random().bytes(std.mem.sliceAsBytes(misses));

    var batches: usize = 0;
    for (levels) |level| {
        for (batches..level / batch_ids) |batch| {
            try recovery.addBatch(&peers, requested[batch * batch_ids ..][0..batch_ids], peer, connection, batch, 0, std.math.maxInt(u64));
        }
        batches = level / batch_ids;
        assert(recovery.len == level);

        const miss_start = timestamp(io);
        for (0..miss_calls) |i| _ = recovery.resolve(&peers, misses[i % misses.len]);
        const miss_ns = timestamp(io) - miss_start;
        assert(recovery.len == level);

        var hit_ns: u64 = 0;
        if (batches > 0) for (0..hit_rounds) |round| {
            const ids = requested[(round % batches) * batch_ids ..][0..batch_ids];
            const hit_start = timestamp(io);
            for (ids) |id| _ = recovery.resolve(&peers, id);
            hit_ns += timestamp(io) - hit_start;
            assert(recovery.len == level - batch_ids);
            try recovery.addBatch(&peers, ids, peer, connection, round, 0, std.math.maxInt(u64));
        };
        const hit_calls: usize = if (batches > 0) hit_rounds * batch_ids else 1;
        std.debug.print("case=recovery_resolve requests={} batches={} miss_ns={d:.1} hit_ns={d:.1}\n", .{ level, recovery.batch_len, perCall(miss_ns, miss_calls), perCall(hit_ns, hit_calls) });
    }
}
