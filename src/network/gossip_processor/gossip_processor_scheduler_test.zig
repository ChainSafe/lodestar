const std = @import("std");
const topic_mod = @import("../gossipsub/topic.zig");
const t = std.testing;
const p = @import("root.zig");
const lists = @import("../index_list.zig");
const Kind = p.limits.Kind;
const Gossipsub = @import("../gossipsub/root.zig").Gossipsub;

fn add(table: *p.GossipProcessor, kind: Kind, now: u64, metadata: p.metadata.Metadata) !p.GossipProcessor.Token {
    const canonical: topic_mod.Canonical = .{ .digest = @splat(0), .name = .{ .kind = kind } };
    var topic: [p.GossipProcessor.topic_max]u8 = undefined;
    try table.capture(&.{
        .handle = .{ .index = 0, .generation = 1 },
        .id = @splat(1),
        .peer = .{ .index = 0, .generation = 1 },
        .topic = topic_mod.buildCanonical(canonical, &topic),
        .bytes = "data",
        .identity = .{ .bytes = @splat(1) },
        .admitted_ms = now,
        .deadline = now + 100,
    }, canonical, &metadata, false, now);
    const index = table.expiry.tail;
    return .{ .index = @intCast(index), .generation = table.cells[index].generation };
}

fn verify(table: *const p.GossipProcessor) !void {
    var occupied: usize = 0;
    var executing: usize = 0;
    var payload: usize = 0;
    for (table.cells, 0..) |cell, i| {
        occupied += @intFromBool(cell.state != .free);
        executing += @intFromBool(cell.executing);
        payload += cell.input.len;
        if (cell.state != .free) try t.expectEqual(cell.state_link.linked, true);
        if (cell.group_index != lists.none) {
            try t.expectEqual(p.GossipProcessor.State.queued, cell.state);
            try t.expect(cell.group_link.linked);
            try t.expectEqual(cell.group_index, table.groups.index.find(table.groups.rows, &table.groups.rows[cell.group_index].key).?);
        }
        if (cell.root_index != lists.none) {
            try t.expectEqual(p.GossipProcessor.State.waiting, cell.state);
            try t.expect(cell.root_link.linked);
        }
        if (cell.expiry_link.next != lists.none) try t.expect(cell.deadline <= table.cells[cell.expiry_link.next].deadline);
        if (cell.state_link.next != lists.none) try t.expectEqual(@as(u32, @intCast(i)), table.cells[cell.state_link.next].state_link.previous);
    }
    for (table.queues) |kind| for (kind, 0..) |queue, state| {
        var next = queue.head;
        var count: usize = 0;
        for (0..table.cells.len) |_| {
            if (next == lists.none) break;
            try t.expectEqual(state, @intFromEnum(table.cells[next].state));
            next = table.cells[next].state_link.next;
            count += 1;
        }
        try t.expectEqual(lists.none, next);
        try t.expectEqual(queue.len, count);
    };
    for (table.groups.timers[0..table.groups.timer_count], 0..) |index, slot| {
        try t.expectEqual(slot, table.groups.rows[index].timer);
        if (slot > 0) try t.expect(table.groups.rows[table.groups.timers[(slot - 1) / 2]].due <= table.groups.rows[index].due);
    }
    try t.expectEqual(occupied, table.diag.occupied);
    try t.expectEqual(executing, table.diag.executing);
    try t.expectEqual(payload, table.diag.payloadBytes);
}

test "gossip scheduler batches kinds as separate validator jobs in native priority order" {
    const limits: p.limits.Limits = @splat(.{ .items = 64, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    _ = try add(&table, .voluntary_exit, 1, .{});
    _ = try add(&table, .voluntary_exit, 1, .{});
    const first_attestation = try add(&table, .beacon_attestation, 1, .{ .group = @splat(7) });
    _ = try add(&table, .beacon_attestation, 1, .{ .group = @splat(7) });
    _ = try add(&table, .beacon_block, 1, .{});
    try t.expect(!table.groups.rows[table.get(first_attestation).?.group_index].ready);
    table.maintain(51, 0);
    const batch = table.claim(51);
    try t.expectEqual(@as(usize, 5), batch.len);
    try t.expectEqual(@as(usize, 4), batch.job_count);
    try t.expectEqualSlices(p.GossipProcessor.Job, &.{
        .{ .kind = .beacon_block, .start = 0, .len = 1, .grouped = false },
        .{ .kind = .voluntary_exit, .start = 1, .len = 1, .grouped = false },
        .{ .kind = .voluntary_exit, .start = 2, .len = 1, .grouped = false },
        .{ .kind = .beacon_attestation, .start = 3, .len = 2, .grouped = true },
    }, batch.jobs[0..batch.job_count]);
    table.finish(&batch);
    try verify(&table);
}

test "gossip scheduler keeps execution charged across timeout until real completion" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    table.execution[0].items = 1;
    const first = try add(&table, .beacon_block, 1, .{});
    const batch = table.claim(1);
    table.finish(&batch);
    const second = try add(&table, .beacon_block, 50, .{});
    table.expire(101);
    try t.expectEqual(@as(usize, 0), table.claim(101).len);
    try t.expectEqual(@as(usize, 4), table.snapshot(101).executingBytes);
    try t.expect(!table.report(first, .accept, 101));
    const ready = table.claim(101);
    try t.expectEqual(second, ready.tokens[0]);
    table.finish(&ready);
    try t.expect(table.report(second, .accept, 102));
    try t.expectEqual(@as(usize, 0), table.diag.executing);
    try verify(&table);
}

test "gossip scheduler budgets mass expiry and root promotion without releasing detached waiters early" {
    const limits: p.limits.Limits = @splat(.{ .items = 512, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const root: [32]u8 = @splat(3);
    for (0..130) |_| _ = try add(&table, .beacon_attestation, 1, .{ .slot = 1, .root = root });
    for (0..3) |_| {
        const checks = table.claimChecks(1, p.GossipProcessor.batch_max);
        for (checks.tokens[0..checks.len]) |token| try t.expect(table.classify(token, false));
    }
    table.notifyBlock(root);
    try t.expectEqual(@as(usize, 130), table.diag.waiting);
    table.maintain(1, 0);
    try t.expectEqual(@as(usize, 66), table.diag.waiting);
    try t.expect(table.pending() or table.deadline().? <= 1);
    table.maintain(1, 0);
    try t.expectEqual(@as(usize, 2), table.diag.waiting);
    table.maintain(1, 0);
    try t.expectEqual(@as(usize, 0), table.diag.waiting);
    table.expire(101);
    try t.expectEqual(@as(usize, 66), table.diag.occupied);
    try t.expect(table.pending() or table.deadline().? <= 101);
    table.expire(101);
    table.expire(101);
    try t.expectEqual(@as(usize, 0), table.diag.occupied);
    try verify(&table);
}

test "gossip scheduler indexes survive bounded randomized lifecycle interleavings" {
    const limits: p.limits.Limits = @splat(.{ .items = 16, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    var random = std.Random.DefaultPrng.init(19);
    const kinds = [_]Kind{ .beacon_block, .beacon_attestation, .voluntary_exit };
    for (0..2000) |step| {
        const now: u64 = @intCast(step);
        const kind = kinds[random.random().uintLessThan(usize, kinds.len)];
        if (table.hasCapacity(kind, 4)) {
            const root: ?[32]u8 = if (kind == .beacon_attestation and step % 3 == 0) @splat(7) else null;
            const group: ?[128]u8 = if (kind == .beacon_attestation) @splat(@intCast(step % 5)) else null;
            _ = try add(&table, kind, now, .{ .root = root, .group = group, .slot = 1 });
        }
        table.maintain(now, 0);
        const checks = table.claimChecks(now, p.GossipProcessor.batch_max);
        if (step % 7 == 0) table.notifyBlock(@splat(7));
        for (checks.tokens[0..checks.len]) |token| _ = table.classify(token, step % 2 == 0);
        const batch = table.claimDemand(now, .{ .items = 3, .ordinary = step % 4 != 0 });
        if (step % 13 == 0) table.expire(now + 1);
        table.finish(&batch);
        for (kinds) |selected| {
            const queue = table.queues[@intFromEnum(selected)][@intFromEnum(p.GossipProcessor.State.delivered)];
            if (queue.head != lists.none and step % 4 != 0) _ = table.report(.{ .index = @intCast(queue.head), .generation = table.cells[queue.head].generation }, .accept, now);
        }
        for (0..p.GossipProcessor.batch_max) |_| table.retire(table.nextCompletion() orelse break);
        try verify(&table);
    }
}

test "gossip scheduler source limits cover unfinished execution and survive peer slot reuse" {
    const limits: p.limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const source: p.GossipProcessor.Source = .{ .index = 0, .generation = 1 };
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    var message: Gossipsub.MessageEvent = .{
        .source = source,
        .handle = .{ .index = 0, .generation = 1 },
        .id = @splat(1),
        .peer = .{ .index = 0, .generation = 1 },
        .topic = topic,
        .bytes = "data",
        .identity = .{ .bytes = @splat(1) },
        .admitted_ms = 1,
        .deadline = 101,
    };
    try table.capture(&message, topic_mod.parseCanonical(topic).?, &.{}, false, 1);
    try table.capture(&message, topic_mod.parseCanonical(topic).?, &.{}, false, 1);
    try t.expectError(error.NetworkGossipFull, table.capture(&message, topic_mod.parseCanonical(topic).?, &.{}, false, 1));
    try t.expect(table.sourceRoom(.{ .index = 1, .generation = 1 }, .beacon_block, 4));
    const batch = table.claim(1);
    table.finish(&batch);
    table.expire(101);
    try t.expect(!table.sourceRoom(source, .beacon_block, 4));
    try t.expect(!table.report(batch.tokens[0], .accept, 102));
    try t.expect(table.sourceRoom(source, .beacon_block, 4));
    message.source.?.generation = 2;
    message.admitted_ms = 102;
    message.deadline = 202;
    try table.capture(&message, topic_mod.parseCanonical(topic).?, &.{}, false, 102);
    try t.expect(!table.report(batch.tokens[1], .ignore, 103));
    try t.expectEqual(@as(usize, 1), table.sources[0].items[0]);
    try verify(&table);
}

test "gossip dependency waiting room belongs to the peer generation" {
    const limits: p.limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const topic = "/eth2/01020304/beacon_attestation_0/ssz_snappy";
    var message: Gossipsub.MessageEvent = .{
        .source = .{ .index = 0, .generation = 1 },
        .handle = .{ .index = 0, .generation = 1 },
        .id = @splat(1),
        .peer = .{ .index = 0, .generation = 1 },
        .topic = topic,
        .bytes = "data",
        .identity = .{ .bytes = @splat(1) },
        .admitted_ms = 1,
        .deadline = 101,
    };
    var tokens: [2]p.GossipProcessor.Token = undefined;
    for (&tokens, 0..) |*token, index| {
        message.source.?.generation = index + 1;
        try table.capture(&message, topic_mod.parseCanonical(topic).?, &.{ .root = @splat(3), .slot = 1 }, false, 1);
        const checks = table.claimChecks(1, 1);
        try t.expectEqual(@as(usize, 1), checks.len);
        token.* = checks.tokens[0];
        try t.expect(table.classify(token.*, false));
        try t.expectEqual(p.GossipProcessor.State.waiting, table.get(token.*).?.state);
    }
    const kind = @intFromEnum(Kind.beacon_attestation);
    try t.expectEqual(@as(u16, 1), table.sources[0].waiting[kind]);
    table.retire(tokens[0]);
    try t.expectEqual(@as(u16, 1), table.sources[0].waiting[kind]);
    table.retire(tokens[1]);
    try t.expectEqual(@as(u16, 0), table.sources[0].waiting[kind]);
    try verify(&table);
}

test "gossip scheduler prefilter permits replacement only for eligible queued kinds" {
    const limits: p.limits.Limits = @splat(.{ .items = 2, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const oldest = try add(&table, .beacon_attestation, 1, .{});
    const newest = try add(&table, .beacon_attestation, 2, .{});
    try t.expect(table.checkAdmissionCapacity(.beacon_attestation, 1));
    const batch = table.claimDemand(2, .{ .items = 1 });
    try t.expectEqual(newest, batch.tokens[0]);
    table.finish(&batch);
    // Protect delivered execution and copying simultaneously.
    table.execution[@intFromEnum(Kind.beacon_attestation)].items = 2;
    const copying = table.claimDemand(2, .{ .items = 1 });
    try t.expectEqual(oldest, copying.tokens[0]);
    try t.expect(!table.checkAdmissionCapacity(.beacon_attestation, 1));
    table.finish(&copying);
    table.retire(oldest);
    try t.expect(table.checkAdmissionCapacity(.beacon_attestation, 1));
    _ = try add(&table, .beacon_block, 3, .{});
    _ = try add(&table, .beacon_block, 4, .{});
    try t.expect(!table.checkAdmissionCapacity(.beacon_block, 1));
    try verify(&table);
}

test "gossip readiness reports checks and executable urgent and ordinary jobs" {
    const limits: p.limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    var table = try p.GossipProcessor.init(t.allocator, .{ .limits = limits });
    defer table.deinit();
    defer table.close();
    const Work = p.GossipProcessor.Work;
    table.execution[@intFromEnum(Kind.data_column_sidecar)].items = 1;
    try t.expectEqual(Work{}, table.readiness());
    _ = try add(&table, .voluntary_exit, 1, .{});
    try t.expectEqual(Work{ .ordinary = true }, table.readiness());
    // A claim of urgent kinds only leaves ordinary work reported.
    try t.expectEqual(@as(usize, 0), table.claimDemand(1, .{ .ordinary = false }).len);
    try t.expectEqual(Work{ .ordinary = true }, table.readiness());
    _ = try add(&table, .data_column_sidecar, 1, .{});
    _ = try add(&table, .data_column_sidecar, 1, .{});
    _ = try add(&table, .beacon_attestation, 1, .{ .slot = 1, .root = @splat(4) });
    try t.expectEqual(Work{ .checks = true, .urgent = true, .ordinary = true }, table.readiness());
    // The column kind at its execution limit reports its second job as not claimable.
    const batch = table.claimDemand(1, .{ .ordinary = false });
    try t.expectEqual(@as(usize, 1), batch.len);
    try t.expectEqual(Work{ .checks = true, .ordinary = true }, table.readiness());
    table.finish(&batch);
    const checks = table.claimChecks(1, p.GossipProcessor.batch_max);
    try t.expectEqual(@as(usize, 1), checks.len);
    try t.expectEqual(Work{ .ordinary = true }, table.readiness());
    try t.expect(table.report(batch.tokens[0], .accept, 1));
    try t.expectEqual(Work{ .urgent = true, .ordinary = true }, table.readiness());
    try verify(&table);
}
