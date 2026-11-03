const std = @import("std");
const topic_mod = @import("../gossipsub/topic.zig");
const p = @import("root.zig");
const t = std.testing;
const index_list = @import("../index_list.zig");
const Gossipsub = @import("../gossipsub/root.zig").Gossipsub;
const PeerId = @import("../wire/peer_id.zig").PeerId;

test "gossip processor validates explicit execution overrides before allocating" {
    const limits: p.limits.Limits = @splat(.{ .items = 3840, .bytes = 4096 });
    const cases = [_]p.limits.Limit{
        .{ .items = 0, .bytes = 4096 },
        .{ .items = 4097, .bytes = 4096 },
        .{ .items = 1, .bytes = 0 },
        .{ .items = 1261, .bytes = 4096 },
        .{ .items = 1, .bytes = 128 * 1024 * 1024 },
    };
    for (cases) |limit| {
        const execution: p.limits.Limits = @splat(limit);
        var failing = t.FailingAllocator.init(t.allocator, .{ .fail_index = 0 });
        try t.expectError(error.InvalidGossipProcessorLimits, p.GossipProcessor.init(failing.allocator(), .{ .limits = limits, .execution = execution }));
        try t.expectError(error.InvalidGossipProcessorLimits, p.GossipProcessor.Options.resolve(limits, execution, &.{}, &.{}, 1));
    }
}

test "gossip processor preserves derived defaults above explicit execution ceilings" {
    const limits: p.limits.Limits = @splat(.{ .items = 3840, .bytes = 4096 });
    const resolved = try p.GossipProcessor.Options.resolve(limits, null, &.{}, &.{}, 1);
    try t.expectEqual(@as(?p.limits.Limits, null), resolved.execution);
    try t.expectEqual(@as(u32, 1920), resolved.executionLimits()[0].items);
    for ([_]p.GossipProcessor.Options{ .{ .limits = limits }, resolved }) |options| {
        var failing = t.FailingAllocator.init(t.allocator, .{ .fail_index = 0 });
        try t.expectError(error.OutOfMemory, p.GossipProcessor.init(failing.allocator(), options));
    }
    const explicit: p.limits.Limits = @splat(.{ .items = 1, .bytes = 4096 });
    const valid = try p.GossipProcessor.Options.resolve(limits, explicit, &.{}, &.{}, 1);
    try t.expectEqualDeep(explicit, valid.executionLimits());
}

test "gossip processor backing bytes match allocations at page boundaries" {
    const page = @import("../gossipsub/message_store.zig").page_bytes;
    const capacities = [_]struct { items: u32, attestations: u32 }{
        .{ .items = 2, .attestations = 2 },
        .{ .items = 64, .attestations = 64 },
        .{ .items = 64, .attestations = 2 },
    };
    for (capacities) |capacity| {
        for ([_]u32{ page, 2 * page }) |kind_bytes| {
            var limits: p.limits.Limits = @splat(.{ .items = capacity.items, .bytes = kind_bytes });
            limits[@intFromEnum(p.limits.Kind.beacon_attestation)].items = capacity.attestations;
            var measured = t.FailingAllocator.init(t.allocator, .{});
            {
                var table = try p.GossipProcessor.init(measured.allocator(), .{ .limits = limits });
                defer table.deinit();
                try t.expectEqual(@as(usize, capacity.attestations), table.groups.rows.len);
                try t.expectEqual(measured.allocated_bytes, p.GossipProcessor.backingBytes(&.{ .limits = limits }));
            }
            try t.expectEqual(measured.allocated_bytes, measured.freed_bytes);
            for (0..measured.alloc_index) |prefix| {
                var failing = t.FailingAllocator.init(t.allocator, .{ .fail_index = prefix });
                try t.expectError(error.OutOfMemory, p.GossipProcessor.init(failing.allocator(), .{ .limits = limits }));
                try t.expectEqual(failing.allocated_bytes, failing.freed_bytes);
            }
        }
    }
}

fn add(table: *p.GossipProcessor, kind: p.limits.Kind, root: ?[32]u8) !p.GossipProcessor.Token {
    const deadline = if (table.expiry.tail == index_list.none) 100 else @max(100, table.cells[table.expiry.tail].deadline);
    return capture(table, kind, "x", .{ .root = root, .slot = 1 }, 0, deadline);
}

fn capture(table: *p.GossipProcessor, kind: p.limits.Kind, bytes: []const u8, metadata: p.metadata.Metadata, now: u64, deadline: u64) !p.GossipProcessor.Token {
    const canonical: topic_mod.Canonical = .{ .digest = @splat(0), .name = .{ .kind = kind } };
    var topic: [p.GossipProcessor.topic_max]u8 = undefined;
    try table.capture(&.{
        .handle = .{ .index = 0, .generation = 1 },
        .id = @splat(1),
        .peer = .{ .index = 0, .generation = 1 },
        .topic = topic_mod.buildCanonical(canonical, &topic),
        .bytes = bytes,
        .identity = .{ .bytes = @splat(1) },
        .admitted_ms = now,
        .deadline = deadline,
    }, canonical, &metadata, false, now);
    const index = table.expiry.tail;
    return .{ .index = @intCast(index), .generation = table.cells[index].generation };
}

test "gossip processor isolates kinds and bounds dependency waiting" {
    const limits: p.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const root: [32]u8 = @splat(7);
    for (0..4) |_| _ = try add(&table, .beacon_attestation, root);
    try t.expectError(error.NetworkGossipFull, add(&table, .beacon_attestation, root));
    const checks = table.claimChecks(1, p.GossipProcessor.batch_max);
    for (checks.tokens[0..checks.len]) |token| try t.expect(table.classify(token, false));
    try t.expectEqual(@as(usize, 2), table.snapshot(1).waiting);
    try t.expectEqual(@as(u64, 2), table.refusals[@intFromEnum(p.limits.Kind.beacon_attestation)][@intFromEnum(p.GossipProcessor.Refusal.dependency_full)]);
    try t.expectEqual([_]u64{ 0, 2, 0, 0 }, table.occupancy(.beacon_attestation));
    const block = try add(&table, .beacon_block, null);
    const batch = table.claimDemand(1, .{ .ordinary = false });
    try t.expectEqual(@as(usize, 1), batch.len);
    try t.expectEqual(block, batch.tokens[0]);
    table.finish(&batch);
    try t.expectEqual([_]u64{ 0, 0, 0, 1 }, table.occupancy(.beacon_block));
    table.notifyBlock(root);
    table.maintain(2, 0);
    const retry = table.claimChecks(2, p.GossipProcessor.batch_max);
    try t.expectEqual(@as(usize, 2), retry.len);
}

test "gossip processor dependency notification cannot race a negative check" {
    const limits: p.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const root: [32]u8 = @splat(2);
    const token = try add(&table, .beacon_attestation, root);
    _ = table.claimChecks(1, p.GossipProcessor.batch_max);
    table.notifyBlock(root);
    try t.expect(table.classify(token, false));
    try t.expectEqual(p.GossipProcessor.State.needs_check, table.get(token).?.state);
    _ = table.claimChecks(2, p.GossipProcessor.batch_max);
    try t.expect(table.classify(token, true));
    const batch = table.claim(2);
    table.finish(&batch);
    table.expire(100);
    try t.expectEqual(@as(usize, 1), table.snapshot(1).executing);
    try t.expect(!table.report(token, .accept, 101));
    try t.expectEqual(@as(usize, 0), table.snapshot(1).executing);
    try t.expectEqual(@as(usize, 0), table.diag.occupied);
}

test "gossip processor releases paged bytes after copying" {
    const payload: [4097]u8 = @splat(9);
    const limits: p.limits.Limits = @splat(.{ .items = 2, .bytes = 8192 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const token = try capture(&table, .beacon_block, &payload, .{}, 0, 100);
    const batch = table.claim(1);
    var bytes: [payload.len]u8 = undefined;
    table.copyPayload(table.get(token).?, &bytes);
    try t.expectEqualSlices(u8, &payload, &bytes);
    table.finish(&batch);
    try t.expectEqual(@as(usize, 1), table.snapshot(1).executing);
    try t.expectEqual(p.GossipProcessor.State.delivered, table.get(token).?.state);
    try t.expectEqual(p.limits.bytes(&limits) / 4096, table.store.free_pages);
}

test "gossip processor claims an item larger than the demand bytes alone" {
    const payload: [4097]u8 = @splat(9);
    const limits: p.limits.Limits = @splat(.{ .items = 4, .bytes = 16384 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    var blocks: [2]p.GossipProcessor.Token = undefined;
    for (&blocks) |*block| {
        block.* = try capture(&table, .beacon_block, &payload, .{}, 0, 100);
    }
    const attestation = try add(&table, .beacon_attestation, null);
    for (blocks) |block| {
        const batch = table.claimDemand(1, .{ .bytes = 4096 });
        try t.expectEqual(@as(usize, 1), batch.len);
        try t.expectEqual(block, batch.tokens[0]);
        table.finish(&batch);
    }
    const batch = table.claimDemand(1, .{ .bytes = 4096 });
    try t.expectEqual(@as(usize, 1), batch.len);
    try t.expectEqual(attestation, batch.tokens[0]);
    table.finish(&batch);
}

test "gossip processor batches identical attestation data with a bounded wait" {
    const limits: p.limits.Limits = @splat(.{ .items = 64, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    for (0..2) |_| _ = try capture(&table, .beacon_attestation, "x", .{ .group = @splat(3) }, 1, 100);
    try t.expectEqual(@as(usize, 0), table.claim(49).len);
    try t.expectEqual(@as(?u64, 51), table.deadline());
    table.maintain(51, 0);
    const batch = table.claim(51);
    try t.expectEqual(@as(usize, 2), batch.len);
    try t.expectEqual(@as(usize, 1), batch.job_count);
    try t.expect(batch.jobs[0].grouped);
    table.finish(&batch);
    try t.expectEqual(@as(usize, 2), table.snapshot(1).executing);
}

test "gossip processor deferral leaves per-source capacity" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const root: [32]u8 = @splat(2);
    const topic = "/eth2/01020304/beacon_attestation_0/ssz_snappy";
    for (0..3) |_| {
        const message: Gossipsub.MessageEvent = .{
            .source = .{ .index = 0, .generation = 1 },
            .handle = .{ .index = 0, .generation = 1 },
            .id = @splat(1),
            .peer = .{ .index = 0, .generation = 1 },
            .topic = topic,
            .bytes = "x",
            .identity = .{ .bytes = @splat(1) },
            .admitted_ms = 1,
            .deadline = 101,
        };
        try table.capture(&message, topic_mod.parseCanonical(topic).?, &.{ .root = root, .slot = 1 }, false, 1);
    }
    const checks = table.claimChecks(1, p.GossipProcessor.batch_max);
    for (checks.tokens[0..checks.len]) |token| try t.expect(table.classify(token, false));
    try t.expectEqual(@as(usize, 2), table.snapshot(1).waiting);
    table.notifyBlock(root);
    table.maintain(1, 0);
    try t.expectEqual(@as(u16, 0), table.sources[0].waiting[@intFromEnum(p.limits.Kind.beacon_attestation)]);
}

test "gossip processor new attestation groups cannot postpone a mature group" {
    const limits: p.limits.Limits = @splat(.{ .items = 64, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const older = try capture(&table, .beacon_attestation, "x", .{ .group = @splat(0) }, 1, 101);
    _ = try capture(&table, .beacon_attestation, "x", .{ .group = @splat(1) }, 50, 150);
    try t.expectEqual(@as(usize, 0), table.claim(50).len);
    try t.expectEqual(@as(?u64, 51), table.deadline());
    table.maintain(51, 0);
    const batch = table.claim(51);
    try t.expectEqual(@as(usize, 1), batch.len);
    try t.expectEqual(older, batch.tokens[0]);
    table.finish(&batch);
}

test "gossip processor copied host work survives native expiry but close releases native ownership" {
    for ([_]bool{ false, true }) |close| {
        const limits: p.limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
        var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
        defer table.deinit();
        defer table.close();
        const token = try add(&table, .beacon_block, null);
        const batch = table.claim(1);
        if (close) table.close() else table.expire(100);
        try t.expectEqual(@as(usize, 1), table.diag.occupied);
        table.finish(&batch);
        try t.expectEqual(@as(usize, if (close) 0 else 1), table.snapshot(101).executing);
        try t.expectEqual(@as(usize, if (close) 0 else 1), table.snapshot(101).expiredExecuting);
        try t.expectEqual(@as(u64, if (close) 0 else 1), table.snapshot(101).oldestExpiredExecutionAgeMs);
        try t.expect(!table.report(token, .accept, 101));
        try t.expectEqual(@as(usize, 0), table.diag.occupied);
    }
}

test "gossip processor expired execution diagnostics track delivered work until actual completion" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 16384 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const first = try add(&table, .beacon_block, null);
    table.finish(&table.claim(10));
    const second = try add(&table, .beacon_block, null);
    table.get(second).?.deadline = 125;
    table.finish(&table.claim(20));
    const reported = try add(&table, .beacon_block, null);
    table.finish(&table.claim(21));
    try t.expect(table.report(reported, .accept, 22));
    _ = try add(&table, .beacon_block, null);
    const copying = table.claim(23);
    try t.expectEqual(@as(usize, 1), copying.len);
    _ = try add(&table, .beacon_block, null);

    try t.expectEqual(@as(usize, 0), table.snapshot(99).expiredExecuting);
    try t.expectEqual(@as(usize, 1), table.snapshot(100).expiredExecuting);
    try t.expectEqual(@as(u64, 0), table.snapshot(100).oldestExpiredExecutionAgeMs);
    table.expire(125);
    try t.expectEqual(@as(usize, 2), table.snapshot(125).expiredExecuting);
    try t.expectEqual(@as(u64, 25), table.snapshot(125).oldestExpiredExecutionAgeMs);
    try t.expectEqual(@as(usize, 2), table.snapshot(140).expiredExecuting);
    try t.expectEqual(@as(u64, 40), table.snapshot(140).oldestExpiredExecutionAgeMs);

    try t.expect(!table.report(first, .accept, 140));
    try t.expectEqual(@as(usize, 1), table.snapshot(140).expiredExecuting);
    try t.expectEqual(@as(u64, 15), table.snapshot(140).oldestExpiredExecutionAgeMs);
    try t.expect(!table.report(first, .reject, 141));
    try t.expectEqual(@as(usize, 1), table.snapshot(141).expiredExecuting);
    table.finish(&copying);
    for (copying.tokens[0..copying.len]) |token| _ = table.report(token, .ignore, 150);
    try t.expect(!table.report(second, .reject, 150));
    try t.expectEqual(@as(usize, 0), table.snapshot(150).expiredExecuting);
    try t.expectEqual(@as(u64, 0), table.snapshot(150).oldestExpiredExecutionAgeMs);
    try t.expectEqual(@as(usize, 0), table.snapshot(150).occupied);
}

test "gossip processor skips exhausted generations and rejects stale handles" {
    var table = try p.GossipProcessor.init(std.testing.allocator, blockOptions(.{ .items = 64, .bytes = 64 * 4096 }));
    defer table.deinit();
    const token = try capture(&table, .beacon_block, "0123456789", .{}, 0, 100);
    table.retire(token);
    table.cells[0].generation = std.math.maxInt(u64);
    const next = try capture(&table, .beacon_block, "0123456789", .{}, 0, 100);
    try std.testing.expectEqual(@as(u16, 1), next.index);
    try std.testing.expect(table.get(token) == null);
    table.retire(next);
}

test "gossip table and payload allocation prefixes unwind shared reservation" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationPrefix, .{});
}
fn allocationPrefix(allocator: std.mem.Allocator) !void {
    var table = try p.GossipProcessor.init(allocator, blockOptions(.{ .items = 1024, .bytes = 64 * 1024 * 1024 }));
    defer table.deinit();
    const token = try capture(&table, .beacon_block, "0123456789", .{}, 0, 100);
    defer table.retire(token);
}

test "gossip batch bounds, rollback and expiry keep pins until full completion" {
    var table = try p.GossipProcessor.init(std.testing.allocator, blockOptions(.{ .items = 1024, .bytes = 64 * 1024 * 1024 }));
    defer table.deinit();
    const data = try std.testing.allocator.alloc(u8, 10 * 1024 * 1024);
    defer std.testing.allocator.free(data);
    @memset(data, 7);
    const first = try capture(&table, .beacon_block, data, .{}, 0, 100);
    _ = try capture(&table, .beacon_block, data[0 .. 7 * 1024 * 1024], .{}, 0, 100);
    var batch = table.claim(99);
    try std.testing.expectEqual(@as(usize, 1), batch.len);
    try std.testing.expectEqual(first, batch.tokens[0]);
    table.expire(100);
    try std.testing.expectEqual(@as(usize, 1), table.diag.occupied);
    table.finish(&batch);
    try std.testing.expect(!table.report(first, .accept, 100));
    try std.testing.expectEqual(@as(u64, 2), table.diag.queuedExpired);
    for (0..65) |_| {
        _ = try capture(&table, .beacon_block, "x", .{}, 100, 200);
    }
    batch = table.claim(101);
    try std.testing.expectEqual(@as(usize, 64), batch.len);
    table.finish(&batch);
    try std.testing.expect(table.oldest() != null);
    try std.testing.expectEqual(@as(usize, 1), table.snapshot(1).queued);
    table.close();
}

test "gossip processor retains reported verdicts across bounded drains" {
    const count = p.GossipProcessor.batch_max + 16;
    var table = try p.GossipProcessor.init(t.allocator, blockOptions(.{ .items = count, .bytes = count * 4096 }));
    defer table.deinit();
    defer table.close();
    for (0..count) |_| _ = try capture(&table, .beacon_block, "x", .{}, 0, 100);
    for (0..2) |_| {
        const batch = table.claim(1);
        table.finish(&batch);
        for (batch.tokens[0..batch.len]) |token| try t.expect(table.report(token, .accept, 2));
    }
    try t.expectEqual(count, table.diag.pendingCompletions);
    for (0..p.GossipProcessor.batch_max) |_| table.retire(table.nextCompletion().?);
    try t.expect(table.pending());
    try t.expectEqual(16, table.diag.pendingCompletions);
    for (0..16) |_| table.retire(table.nextCompletion().?);
    try t.expectEqual(0, table.diag.occupied);
    try t.expect(!table.pending());
    try t.expectEqual(null, table.nextCompletion());
}

test "gossip processor retires expired verdicts and rejects stale generations" {
    var table = try p.GossipProcessor.init(std.testing.allocator, blockOptions(.{ .items = 64, .bytes = 64 * 4096 }));
    defer table.deinit();
    var handles: [64]p.GossipProcessor.Token = undefined;
    for (&handles) |*token| {
        token.* = try capture(&table, .beacon_block, "x", .{}, 0, 100);
    }
    try std.testing.expectError(error.NetworkGossipFull, capture(&table, .beacon_block, "x", .{}, 0, 100));
    const batch = table.claim(1);
    table.finish(&batch);
    for (handles) |token| {
        try std.testing.expect(table.report(token, .accept, 2));
        try std.testing.expect(!table.report(token, .reject, 2));
    }
    try std.testing.expectEqual(@as(usize, 64), table.snapshot(1).pendingCompletions);
    try std.testing.expect(table.pending());
    table.expire(100);
    try std.testing.expect(!table.pending() and table.deadline() == null);
    try std.testing.expectEqual(@as(usize, 0), table.snapshot(1).occupied);
    _ = try capture(&table, .beacon_block, "y", .{}, 100, 200);
    try std.testing.expect(!table.report(handles[0], .accept, 101));
    table.close();
}

test "gossip processor groups attestation data across subnets only within the same fork" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const topics = [_]topic_mod.Canonical{
        .{ .digest = .{ 1, 2, 3, 4 }, .name = .{ .kind = .beacon_attestation, .subnet = 0 } },
        .{ .digest = .{ 1, 2, 3, 4 }, .name = .{ .kind = .beacon_attestation, .subnet = 1 } },
        .{ .digest = .{ 5, 6, 7, 8 }, .name = .{ .kind = .beacon_attestation, .subnet = 0 } },
    };
    for (topics, 0..) |canonical, i| {
        var wire: [topic_mod.topic_max_len]u8 = undefined;
        try table.capture(&.{
            .handle = .{ .index = @intCast(i), .generation = 1 },
            .id = @splat(@intCast(i)),
            .peer = .{ .index = 0, .generation = 1 },
            .identity = .{ .bytes = @splat(1) },
            .topic = topic_mod.buildCanonical(canonical, &wire),
            .bytes = "x",
            .admitted_ms = 1,
            .deadline = 100,
        }, canonical, &.{ .group = @splat(3) }, true, 1);
    }
    table.maintain(51, 0);
    const batch = table.claim(51);
    defer table.finish(&batch);
    try t.expectEqual(@as(usize, 3), batch.len);
    try t.expectEqual(@as(usize, 2), batch.job_count);
    try t.expectEqual(@as(usize, 1), batch.jobs[0].len);
    try t.expectEqual(@as(usize, 2), batch.jobs[1].len);
    for (batch.jobs[0..batch.job_count]) |job| {
        try t.expect(job.grouped);
        for (batch.tokens[job.start..][0..job.len]) |token| {
            const cell = table.get(token).?;
            const canonical = topic_mod.parseCanonical(cell.topic[0..cell.topic_len]).?;
            try t.expectEqual(if (job.len == 2) topics[0].digest else topics[2].digest, canonical.digest);
        }
    }
}

fn blockOptions(block: p.limits.Limit) p.GossipProcessor.Options {
    var limits: p.limits.Limits = @splat(.{ .items = 2, .bytes = 4096 });
    limits[@intFromEnum(p.limits.Kind.beacon_block)] = block;
    return .{ .limits = limits, .execution = limits };
}

test "gossip processor fatal peer cleanup is bounded and preserves other peers and host work" {
    const limits: p.limits.Limits = @splat(.{ .items = 128, .bytes = 16384 });
    var allocator = t.FailingAllocator.init(t.allocator, .{});
    var table = try p.GossipProcessor.init(allocator.allocator(), .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const bad: TestPeer = .{ .index = 0 };
    const good: TestPeer = .{ .index = 1 };
    const delivered = try bad.capture(&table, .beacon_block, .{}, 1);
    const executing = table.claimDemand(1, .{ .ordinary = false });
    table.finish(&executing);
    const copying = try bad.capture(&table, .beacon_block, .{}, 1);
    const borrowed = table.claimDemand(1, .{ .ordinary = false });
    defer table.finish(&borrowed);
    const waiting = try bad.capture(&table, .beacon_attestation, .{ .root = @splat(3), .slot = 1 }, 1);
    const checking = try bad.capture(&table, .beacon_attestation, .{ .root = @splat(4), .slot = 1 }, 1);
    const checks = table.claimChecks(1, 2);
    try t.expectEqual(@as(usize, 2), checks.len);
    try t.expect(table.classify(waiting, false));
    const needs_check = try bad.capture(&table, .beacon_attestation, .{ .root = @splat(5), .slot = 1 }, 1);
    var queued: [128]p.GossipProcessor.Token = undefined;
    for (&queued, 0..) |*token, i| {
        token.* = try (if (i % 2 == 0) bad else good).capture(&table, .sync_committee, .{}, 1);
    }
    const allocations = allocator.allocations;
    table.dropPeer(&bad.identity());
    for (0..std.math.divCeil(usize, table.cells.len, p.GossipProcessor.batch_max) catch unreachable) |_| {
        const before = table.diag.pendingCompletions;
        table.maintain(1, 0);
        try t.expect(table.diag.pendingCompletions - before <= p.GossipProcessor.batch_max);
    }
    try t.expectEqual(@as(usize, 0), table.prune_remaining);
    try t.expectEqual(@as(usize, 66), table.diag.pendingCompletions);
    for (queued, 0..) |token, i| {
        const cell = table.get(token).?;
        try t.expectEqual(if (i % 2 == 0) p.GossipProcessor.State.completion_pending else .queued, cell.state);
        if (i % 2 == 0) try t.expectEqual(p.GossipProcessor.Completion.cancelled, cell.completion);
    }
    for ([_]p.GossipProcessor.Token{ waiting, needs_check }) |token| {
        try t.expectEqual(p.GossipProcessor.State.completion_pending, table.get(token).?.state);
        try t.expectEqual(p.GossipProcessor.Completion.cancelled, table.get(token).?.completion);
    }
    try t.expectEqual(p.GossipProcessor.State.checking, table.get(checking).?.state);
    try t.expectEqual(p.GossipProcessor.State.delivered, table.get(delivered).?.state);
    try t.expectEqual(p.GossipProcessor.State.copying, table.get(copying).?.state);
    try t.expectEqual(allocations, allocator.allocations);
}

const TestPeer = struct {
    index: u16,
    generation: u64 = 1,

    fn identity(self: TestPeer) PeerId {
        var result: PeerId = .{ .bytes = @splat(0) };
        std.mem.writeInt(u16, result.bytes[0..2], self.index, .little);
        std.mem.writeInt(u64, result.bytes[2..10], self.generation, .little);
        return result;
    }

    fn capture(self: TestPeer, table: *p.GossipProcessor, kind: p.limits.Kind, metadata: p.metadata.Metadata, now: u64) !p.GossipProcessor.Token {
        const canonical: topic_mod.Canonical = .{ .digest = @splat(0), .name = .{ .kind = kind } };
        var topic: [p.GossipProcessor.topic_max]u8 = undefined;
        try table.capture(&.{
            .source = .{ .index = self.index, .generation = self.generation },
            .handle = .{ .index = 0, .generation = 1 },
            .id = @splat(1),
            .peer = .{ .index = self.index, .generation = 1 },
            .topic = topic_mod.buildCanonical(canonical, &topic),
            .bytes = "x",
            .identity = self.identity(),
            .admitted_ms = now,
            .deadline = now + 100,
        }, canonical, &metadata, false, now);
        const index = table.expiry.tail;
        return .{ .index = @intCast(index), .generation = table.cells[index].generation };
    }
};

test "gossip processor claims skip fatal peers before their prune pass reaches the cells" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const bad_peer: TestPeer = .{ .index = 0 };
    const good_peer: TestPeer = .{ .index = 1 };
    const bad = try bad_peer.capture(&table, .voluntary_exit, .{}, 1);
    const good = try good_peer.capture(&table, .voluntary_exit, .{}, 1);
    const bad_check = try bad_peer.capture(&table, .beacon_attestation, .{ .root = @splat(3), .slot = 1 }, 1);
    const grouped_bad = try bad_peer.capture(&table, .beacon_attestation, .{ .slot = 1, .group = @splat(7) }, 1);
    const grouped_good = try good_peer.capture(&table, .beacon_attestation, .{ .slot = 1, .group = @splat(7) }, 1);
    table.maintain(51, 0);
    table.dropPeer(&bad_peer.identity());
    const fresh = try bad_peer.capture(&table, .voluntary_exit, .{}, 51);
    try t.expectEqual(@as(usize, 0), table.claimChecks(51, p.GossipProcessor.batch_max).len);
    const batch = table.claim(51);
    try t.expectEqualSlices(p.GossipProcessor.Token, &.{ good, fresh, grouped_good }, batch.tokens[0..batch.len]);
    table.finish(&batch);
    for ([_]p.GossipProcessor.Token{ bad, bad_check, grouped_bad }) |token| {
        try t.expectEqual(p.GossipProcessor.State.completion_pending, table.get(token).?.state);
    }
}

test "gossip processor fatal reports preserve unrelated work at full source capacity" {
    const capacity = @import("../gossipsub/peer_book.zig").capacity;
    var limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    limits[@intFromEnum(p.limits.Kind.sync_committee)].items = capacity;
    var allocator = t.FailingAllocator.init(t.allocator, .{});
    var table = try p.GossipProcessor.init(allocator.allocator(), .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const good: TestPeer = .{ .index = capacity - 1 };
    const old = try good.capture(&table, .data_column_sidecar, .{}, 1);
    var bad: [capacity - 1]p.GossipProcessor.Token = undefined;
    for (&bad, 0..) |*token, i| token.* = try (TestPeer{ .index = @intCast(i) }).capture(&table, .sync_committee, .{}, 1);
    const allocations = allocator.allocations;
    for (0..bad.len) |i| table.dropPeer(&(TestPeer{ .index = @intCast(i) }).identity());
    const fresh = try good.capture(&table, .data_column_sidecar, .{}, 1);
    for (0..std.math.divCeil(usize, table.cells.len, p.GossipProcessor.batch_max) catch unreachable) |_| {
        const before = table.diag.pendingCompletions;
        table.maintain(1, 0);
        try t.expect(table.diag.pendingCompletions - before <= p.GossipProcessor.batch_max);
    }
    for (bad) |token| try t.expectEqual(p.GossipProcessor.State.completion_pending, table.get(token).?.state);
    try t.expectEqual(p.GossipProcessor.State.queued, table.get(old).?.state);
    try t.expectEqual(p.GossipProcessor.State.queued, table.get(fresh).?.state);
    try t.expectEqual(@as(usize, 0), table.prune_remaining);
    try t.expectEqual(allocations, allocator.allocations);
}

test "gossip processor repeated and unknown fatal reports preserve prune progress" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const peer: TestPeer = .{ .index = 0 };
    const unknown: TestPeer = .{ .index = 1 };
    const old = try peer.capture(&table, .data_column_sidecar, .{}, 1);
    table.dropPeer(&unknown.identity());
    try t.expectEqual(@as(usize, 0), table.prune_remaining);
    table.dropPeer(&peer.identity());
    for (0..std.math.divCeil(usize, table.cells.len, p.GossipProcessor.batch_max) catch unreachable) |_| {
        table.maintain(1, 0);
        const remaining = table.prune_remaining;
        const cursor = table.prune_cursor;
        table.dropPeer(&peer.identity());
        table.dropPeer(&unknown.identity());
        try t.expectEqual(remaining, table.prune_remaining);
        try t.expectEqual(cursor, table.prune_cursor);
    }
    try t.expectEqual(@as(usize, 0), table.prune_remaining);
    try t.expectEqual(p.GossipProcessor.State.completion_pending, table.get(old).?.state);
    const fresh = try peer.capture(&table, .data_column_sidecar, .{}, 1);
    const batch = table.claim(1);
    try t.expectEqualSlices(p.GossipProcessor.Token, &.{fresh}, batch.tokens[0..batch.len]);
    table.finish(&batch);
}

test "gossip processor fatal cutoff survives dependency checks returning after pruning" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const peer: TestPeer = .{ .index = 0 };
    const checking = try peer.capture(&table, .beacon_attestation, .{ .root = @splat(3), .slot = 1 }, 1);
    const checks = table.claimChecks(1, 1);
    try t.expectEqualSlices(p.GossipProcessor.Token, &.{checking}, checks.tokens[0..checks.len]);
    table.dropPeer(&peer.identity());
    for (0..std.math.divCeil(usize, table.cells.len, p.GossipProcessor.batch_max) catch unreachable) |_| table.maintain(1, 0);
    try t.expectEqual(@as(usize, 0), table.prune_remaining);
    try t.expectEqual(p.GossipProcessor.State.checking, table.get(checking).?.state);
    try t.expect(table.classify(checking, true));
    try t.expectEqual(@as(usize, 0), table.claim(1).len);
    try t.expectEqual(p.GossipProcessor.State.completion_pending, table.get(checking).?.state);
}

test "gossip processor fatal cutoff does not transfer across source generations" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const old: TestPeer = .{ .index = 0 };
    const new: TestPeer = .{ .index = 0, .generation = 2 };
    const delivered = try old.capture(&table, .beacon_block, .{}, 1);
    const batch = table.claim(1);
    table.finish(&batch);
    const queued = try old.capture(&table, .sync_committee, .{}, 1);
    table.dropPeer(&old.identity());
    for (0..std.math.divCeil(usize, table.cells.len, p.GossipProcessor.batch_max) catch unreachable) |_| table.maintain(1, 0);
    try t.expectEqual(p.GossipProcessor.State.completion_pending, table.get(queued).?.state);
    table.retire(queued);
    table.expire(101);
    const fresh = try new.capture(&table, .beacon_block, .{}, 102);
    table.dropPeer(&old.identity());
    try t.expectEqual(@as(usize, 0), table.prune_remaining);
    try t.expect(!table.report(delivered, .reject, 102));
    try t.expectEqual(@as(usize, 1), table.sources[0].items[@intFromEnum(p.limits.Kind.beacon_block)]);
    const next = table.claim(102);
    try t.expectEqualSlices(p.GossipProcessor.Token, &.{fresh}, next.tokens[0..next.len]);
    table.finish(&next);
}
