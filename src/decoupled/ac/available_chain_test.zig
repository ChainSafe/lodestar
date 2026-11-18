const std = @import("std");
const testing = std.testing;
const BoundedArray = @import("bounded_array").BoundedArray;
const ac = @import("available_chain.zig");
const Chain = ac.AvailableChain;
const Frame = ac.Frame;
const types = @import("../types.zig");
const limits = @import("../limits.zig");
const Root = types.Root;
const Vote = types.GoldfishVote;
const max_votes = 2 * limits.max_validators;
const delta: u32 = 4;

fn root(n: u32) Root {
    var result: Root = @splat(0);
    std.mem.writeInt(u32, result[0..4], n, .little);
    return result;
}

const Storage = struct {
    votes: BoundedArray(ac.SignedVote, max_votes) = .{},
    support: BoundedArray(Vote, max_votes) = .{},
};

const Fixture = struct {
    chain: Chain,
    blocks: [limits.max_blocks]Frame.Block,
    storage: [limits.max_blocks]Storage,
    count: u32,
    heads: Frame.Mask,
    fc_root: Root,
    emitted: [4 * limits.max_slots]?Vote,
    next_tick: u32,

    fn create(k: u32) !*Fixture {
        const f = try testing.allocator.create(Fixture);
        errdefer testing.allocator.destroy(f);
        try f.chain.init(&.{
            .genesis_root = root(0),
            .validator_count = 8,
            .validator_index = 7,
            .delta = delta,
            .delta_f = delta,
            .R = 2,
            .k = k,
        });
        f.blocks[0] = .{ .root = root(0), .parent = root(0), .slot = 0 };
        f.count = 1;
        f.heads = @splat(false);
        f.heads[0] = true;
        f.fc_root = root(0);
        f.emitted = @splat(null);
        f.next_tick = 0;
        return f;
    }

    fn destroy(f: *Fixture) void {
        testing.allocator.destroy(f);
    }

    fn frame(f: *const Fixture) !Frame {
        return Frame.init(f.blocks[0..f.count], &f.fc_root, &f.heads);
    }

    fn at(f: *Fixture, t: u32) !void {
        if (f.chain.restart_time) |wake| {
            const first_tick = wake + (delta - wake % delta) % delta;
            f.next_tick = @max(f.next_tick, first_tick);
        }
        var ticks: u32 = 0;
        while (f.next_tick <= t) : (ticks += 1) {
            std.debug.assert(ticks < 4 * limits.max_slots);
            const tick = f.next_tick;
            const view = try f.frame();
            f.emitted[tick / delta] = try f.chain.onTick(&view, tick);
            f.next_tick += delta;
        }
    }

    fn accept(f: *Fixture, t: u32, s: u32, parent: u32) !u32 {
        return f.acceptPayload(t, s, parent, &.{});
    }

    fn acceptPayload(f: *Fixture, t: u32, s: u32, parent: u32, payload: *const ac.Payload) !u32 {
        try f.at(t);
        const index = f.count;
        f.storage[index] = .{};
        for (payload.votes) |signed| f.storage[index].votes.push(signed);
        for (payload.support_votes) |vote| f.storage[index].support.push(vote);
        f.blocks[index] = .{
            .root = root(index),
            .parent = f.blocks[parent].root,
            .slot = s,
            .payload = .{
                .votes = f.storage[index].votes.constSlice(),
                .support_votes = f.storage[index].support.constSlice(),
            },
        };
        try f.chain.onBlock(t, &f.blocks[index]);
        f.count += 1;
        f.heads[index] = true;
        return index;
    }

    fn cast(f: *Fixture, t: u32, s: u32, count: u32, head: u32) !void {
        try f.at(t);
        for (0..count) |v| {
            try testing.expectEqual(Chain.Admission.accepted, try f.chain.onMessage(t, &.{
                .val_index = @intCast(v),
                .slot = s,
                .head = f.blocks[head].root,
            }));
        }
    }
};

fn expectRoot(expected: u32, actual: Root) !void {
    try testing.expectEqual(root(expected), actual);
}

fn expectSame(a: *const Chain, b: *const Chain) !void {
    try testing.expectEqualDeep(a.config, b.config);
    try testing.expectEqual(a.restart_time, b.restart_time);
    try testing.expectEqual(a.latest_confirmed, b.latest_confirmed);
    try testing.expectEqualDeep(a.saved_confirmation, b.saved_confirmation);
    try testing.expectEqualDeep(a.locks.constSlice(), b.locks.constSlice());
    try testing.expectEqualDeep(a.fast_confirmed.constSlice(), b.fast_confirmed.constSlice());
    try testing.expectEqualDeep(a.observations.constSlice(), b.observations.constSlice());
    for (&a.pools, &b.pools) |*left, *right| {
        try testing.expectEqualDeep(left.constSlice(), right.constSlice());
    }
}

test "initial duties handle negative-slot pools and process the self vote immediately" {
    const f = try Fixture.create(2);
    defer f.destroy();
    try f.at(0);
    const view = try f.frame();
    var proposal: Chain.Proposal = undefined;
    try testing.expect(try f.chain.proposal(&view, 0, &proposal));
    try expectRoot(0, proposal.parent);
    try testing.expectEqual(@as(u32, 0), proposal.votes.count);
    try f.at(4);
    try expectRoot(0, f.emitted[1].?.head);
    try testing.expectEqual(@as(u32, 0), f.emitted[1].?.slot);
    try testing.expectEqual(@as(u32, 1), f.chain.pools[0].count);
    try f.at(24);
    try testing.expect(f.chain.saved_confirmation[0] != null);
    try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
}

test "half-committee fast test follows a strict-majority confirmation and writes one deadline" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    try f.cast(37, 2, 3, a);
    try f.at(40);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    try expectRoot(a, f.chain.locks.buffer[0].block);
    try testing.expectEqual(@as(u32, 84), f.chain.locks.buffer[0].deadline);
    try expectRoot(a, f.chain.saved_confirmation[1].?);
    try expectRoot(a, f.chain.latest_confirmed);
    try testing.expectEqual(@as(u32, 1), f.chain.fast_confirmed.count);
    try f.at(56);
    try testing.expectEqual(@as(u32, 2), f.chain.locks.count);
    try expectRoot(a, f.chain.locks.buffer[1].block);
    try testing.expectEqual(@as(u32, 100), f.chain.locks.buffer[1].deadline);
}

test "odd validator thresholds round up and a single-validator chain can fast lock" {
    for ([_]u32{ 1, 5 }) |n| {
        const f = try Fixture.create(3);
        defer f.destroy();
        var config = f.chain.config;
        config.validator_count = n;
        config.validator_index = n - 1;
        try f.chain.init(&config);
        const a = try f.accept(17, 1, 0);
        if (n == 5) {
            try f.cast(21, 1, 1, a);
            try f.cast(37, 2, 2, a);
        }
        try f.at(40);
        try testing.expectEqual(@as(u32, if (n == 1) 1 else 0), f.chain.locks.count);
        if (n == 5) {
            try f.at(56);
            try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
        }
        try expectRoot(a, f.chain.locks.buffer[0].block);
    }
}

test "sparse confirmations create a slow lock only after k consecutive results" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 1, a);
    for (1..4) |s| {
        if (s < 3) try f.cast(@as(u32, @intCast(s + 1)) * 16 + 5, @intCast(s + 1), 1, a);
        try f.at(@as(u32, @intCast(s)) * 16 + 24);
        try testing.expectEqual(@as(u32, if (s == 3) 1 else 0), f.chain.locks.count);
        try testing.expectEqual(@as(u32, 0), f.chain.fast_confirmed.count);
    }
    try expectRoot(a, f.chain.locks.buffer[0].block);
    try testing.expectEqual(@as(u32, 116), f.chain.locks.buffer[0].deadline);
}

test "equal-half fork split confirms only F and cannot write conflicting fast locks" {
    const f = try Fixture.create(2);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const b = try f.accept(18, 1, 0);
    try f.cast(19, 1, 4, a);
    for (4..7) |v| {
        _ = try f.chain.onMessage(19, &.{
            .val_index = @intCast(v),
            .slot = 1,
            .head = root(b),
        });
    }
    try f.at(40);
    try expectRoot(0, f.chain.saved_confirmation[1].?);
    try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
    try testing.expectEqual(@as(u32, 0), f.chain.fast_confirmed.count);
}

test "veto saves raw confirmation for a later slow lock without advancing the record" {
    const f = try Fixture.create(2);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const b = try f.accept(33, 2, 0);
    try f.cast(37, 2, 3, b);
    try f.cast(53, 3, 3, b);
    try f.at(56);
    try expectRoot(b, f.chain.saved_confirmation[2].?);
    try expectRoot(a, f.chain.latest_confirmed);
    try testing.expectEqual(@as(u32, 0), f.chain.fast_confirmed.count);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    try f.at(72);
    try expectRoot(b, f.chain.latest_confirmed);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    try expectRoot(b, f.chain.locks.buffer[0].block);
    try testing.expectEqual(@as(u32, 100), f.chain.locks.buffer[0].deadline);
    try testing.expectEqual(@as(u32, 0), f.chain.fast_confirmed.count);
}

test "exactly-half opposition rolls a lock back to F without changing its deadline" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const b = try f.accept(33, 2, 0);
    try f.cast(37, 2, 4, b);
    try f.at(52);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    try expectRoot(0, f.chain.locks.buffer[0].block);
    try testing.expectEqual(@as(u32, 84), f.chain.locks.buffer[0].deadline);
}

test "nonviable locks still veto and viable ancestors of locks still anchor the head" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const b = try f.accept(33, 2, 0);
    try f.cast(37, 2, 3, b);
    try f.at(40);
    f.heads = @splat(false);
    f.heads[b] = true;
    try f.at(56);
    try expectRoot(b, f.chain.saved_confirmation[2].?);
    try expectRoot(a, f.chain.latest_confirmed);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    const view = try f.frame();
    try expectRoot(b, try f.chain.head(&view, 56));
    try expectRoot(0, try f.chain.confirmed(&view, 56));
    f.heads[a] = true;
    f.heads[b] = false;
    const restored = try f.frame();
    try expectRoot(a, try f.chain.head(&restored, 56));
}

test "late viable witnesses do not enter a frozen voter domain without a current proposal" {
    for ([_]bool{ false, true }) |proposal_present| {
        const f = try Fixture.create(3);
        defer f.destroy();
        const a = try f.accept(17, 1, 0);
        const witness = try f.accept(45, 2, a);
        f.heads = @splat(false);
        f.heads[witness] = true;
        const expected = if (proposal_present) try f.accept(49, 3, witness) else 0;
        try f.at(52);
        try expectRoot(expected, f.emitted[13].?.head);
        const view = try f.frame();
        try expectRoot(if (proposal_present) expected else witness, try f.chain.head(&view, 52));
    }
}

test "full-tree anchor remains the walk start even outside the frozen viable domain" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const witness = try f.accept(45, 2, a);
    f.heads = @splat(false);
    f.heads[witness] = true;
    try f.at(52);
    try expectRoot(a, f.emitted[13].?.head);
    const view = try f.frame();
    try expectRoot(witness, try f.chain.head(&view, 52));
}

test "carried support for a future head stays unresolved and cannot enable an old child" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const vote: Vote = .{ .slot = 1, .val_index = 0, .head = root(2) };
    const raw = [_]ac.SignedVote{.{ .vote = vote, .authenticated = true }};
    const support = [_]Vote{vote};
    _ = try f.acceptPayload(33, 2, a, &.{ .votes = &raw, .support_votes = &support });
    const view = try f.frame();
    try testing.expectEqual(@as(?u32, null), f.chain.resolutionTime(&view, 1, &vote));
    try f.at(36);
    try expectRoot(0, f.emitted[9].?.head);
}

test "resolution observes late block arrival and current frame membership" {
    const f = try Fixture.create(3);
    defer f.destroy();
    try f.cast(19, 1, 1, 0);
    const vote: Vote = .{ .slot = 1, .val_index = 1, .head = root(1) };
    _ = try f.chain.onMessage(19, &vote);
    const before = try f.frame();
    try testing.expectEqual(@as(?u32, null), f.chain.resolutionTime(&before, 1, &vote));
    const a = try f.accept(23, 1, 0);
    const after = try f.frame();
    try testing.expectEqual(@as(?u32, 23), f.chain.resolutionTime(&after, 1, &vote));
    const b = try f.accept(33, 2, 0);
    var heads: Frame.Mask = @splat(false);
    heads[0] = true;
    const finalized = try Frame.init(f.blocks[b..][0..1], &root(b), &heads);
    try testing.expectEqual(@as(?u32, null), f.chain.resolutionTime(&finalized, 1, &vote));
    try testing.expect(a != b);
}

test "support cutoff is strict for votes and for block resolution" {
    for ([_]u32{ 23, 24, 25 }) |arrival| {
        const f = try Fixture.create(3);
        defer f.destroy();
        const a = try f.accept(17, 1, 0);
        try f.cast(arrival, 1, 3, a);
        try f.at(40);
        try testing.expectEqual(@as(u32, if (arrival < 24) 1 else 0), f.chain.locks.count);
        if (arrival < 24) {
            try expectRoot(a, f.chain.saved_confirmation[1].?);
        } else {
            try testing.expectEqual(@as(?Root, null), f.chain.saved_confirmation[1]);
        }
    }
    for ([_]u32{ 23, 24 }) |arrival| {
        const f = try Fixture.create(3);
        defer f.destroy();
        try f.at(19);
        for (0..3) |v| {
            _ = try f.chain.onMessage(19, &.{
                .slot = 1,
                .val_index = @intCast(v),
                .head = root(1),
            });
        }
        _ = try f.accept(arrival, 1, 0);
        try f.at(40);
        if (arrival < 24) {
            try expectRoot(1, f.chain.saved_confirmation[1].?);
        } else {
            try testing.expectEqual(@as(?Root, null), f.chain.saved_confirmation[1]);
        }
        try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
    }
}

test "proposal preserves pool order and includes exactly its resolved support subset" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 2, a);
    const unresolved: Vote = .{ .slot = 1, .val_index = 2, .head = root(99) };
    _ = try f.chain.onMessage(22, &unresolved);
    try f.at(32);
    const view = try f.frame();
    var proposal: Chain.Proposal = undefined;
    try testing.expect(try f.chain.proposal(&view, 32, &proposal));
    try testing.expectEqual(@as(u32, 4), proposal.votes.count);
    try testing.expectEqual(@as(u32, 3), proposal.support_votes.count);
    try testing.expectEqual(@as(u32, 7), proposal.votes.buffer[0].vote.val_index);
    try testing.expect(proposal.votes.buffer[3].vote.eql(&unresolved));
}

test "head switches from previous to current votes at the support boundary" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const b = try f.accept(18, 1, 0);
    try f.cast(19, 1, 2, a);
    try f.cast(35, 2, 2, b);
    try f.at(39);
    const view = try f.frame();
    try expectRoot(a, try f.chain.head(&view, 39));
    try f.at(40);
    const updated = try f.frame();
    try expectRoot(b, try f.chain.head(&updated, 40));
}

test "FG action uses only fresh fast sources and rechecks the frame" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    try f.cast(37, 2, 3, a);
    try f.at(40);
    try f.at(56);
    const action_view = try f.frame();
    const input = try f.chain.toFG(&action_view, 56);
    try expectRoot(a, input.fg_confirmed.?);
    try expectRoot(a, input.head);
    const b = try f.accept(57, 3, 0);
    f.heads = @splat(false);
    f.heads[b] = true;
    try f.at(88);
    const later = try f.frame();
    try testing.expectEqual(@as(?Root, null), (try f.chain.toFG(&later, 88)).fg_confirmed);
}

test "restart persists locks and record, restamps blocks, and gates all vote-reading duties" {
    for ([_]u32{ 48, 49 }) |wake| {
        const f = try Fixture.create(3);
        defer f.destroy();
        const a = try f.accept(17, 1, 0);
        try f.cast(21, 1, 3, a);
        try f.at(40);
        const view = try f.frame();
        try f.chain.restart(&view, wake);
        try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
        try testing.expectEqual(@as(u32, 84), f.chain.locks.buffer[0].deadline);
        try expectRoot(a, f.chain.latest_confirmed);
        try testing.expectEqual(@as(u32, 0), f.chain.pools[1].count);
        try testing.expectEqual(wake, f.chain.observations.buffer[0].timestamp);
        try f.at(56);
        try testing.expectEqual(@as(?Vote, null), f.emitted[13]);
        try testing.expectEqual(@as(?Root, null), f.chain.saved_confirmation[2]);
        try testing.expectEqual(@as(?Root, null), (try f.chain.toFG(&view, 56)).fg_confirmed);
        var proposal: Chain.Proposal = undefined;
        try f.at(64);
        try testing.expectEqual(wake == 48, try f.chain.proposal(&view, 64, &proposal));
        try f.at(68);
        try testing.expectEqual(wake == 48, f.emitted[17] != null);
        try f.at(84);
        for (f.chain.locks.constSlice()) |lock| try testing.expect(lock.deadline > 84);
    }
}

test "restart replays carried previous-slot votes in parent order at the wake stamp" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const raw = [_]ac.SignedVote{.{
        .vote = .{ .slot = 1, .val_index = 0, .head = root(a) },
        .authenticated = true,
    }};
    _ = try f.acceptPayload(33, 2, a, &.{ .votes = &raw });
    const view = try f.frame();
    try f.chain.restart(&view, 35);
    try testing.expectEqual(@as(u32, 1), f.chain.pools[1].count);
    try testing.expectEqual(@as(u32, 35), f.chain.pools[1].buffer[0].timestamp);
    try testing.expectEqual(@as(?u32, 35), f.chain.resolutionTime(&view, 1, &raw[0].vote));
}

test "payload validation refuses a whole malformed block without state mutation" {
    const f = try Fixture.create(3);
    defer f.destroy();
    try f.at(33);
    const before = try testing.allocator.create(Chain);
    defer testing.allocator.destroy(before);
    before.* = f.chain;
    var raw = [_]ac.SignedVote{.{
        .vote = .{ .slot = 1, .val_index = 0, .head = root(0) },
        .authenticated = false,
    }};
    var block: Frame.Block = .{
        .root = root(1),
        .parent = root(0),
        .slot = 2,
        .payload = .{ .votes = &raw },
    };
    try testing.expect(!try f.chain.validPayload(&block));
    raw[0].authenticated = true;
    raw[0].vote.val_index = 8;
    try testing.expect(!try f.chain.validPayload(&block));
    raw[0].vote.val_index = 0;
    raw[0].vote.slot = 0;
    try testing.expect(!try f.chain.validPayload(&block));
    raw[0].vote.slot = 1;
    const absent = [_]Vote{.{ .slot = 1, .val_index = 1, .head = root(0) }};
    block.payload.support_votes = &absent;
    try testing.expect(!try f.chain.validPayload(&block));
    try expectSame(before, &f.chain);
    const oversized = try testing.allocator.alloc(ac.SignedVote, max_votes + 1);
    defer testing.allocator.free(oversized);
    block.payload = .{ .votes = oversized };
    try testing.expectError(error.PayloadCapacity, f.chain.validPayload(&block));
    try expectSame(before, &f.chain);
    const oversized_support = try testing.allocator.alloc(Vote, max_votes + 1);
    defer testing.allocator.free(oversized_support);
    block.payload = .{ .support_votes = oversized_support };
    try testing.expectError(error.PayloadCapacity, f.chain.validPayload(&block));
    try expectSame(before, &f.chain);
}

test "payload lists preserve repeats and order without imposing the pool's two-vote cap" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const raw = [_]ac.SignedVote{
        .{ .vote = .{ .slot = 1, .val_index = 0, .head = root(a) }, .authenticated = true },
        .{ .vote = .{ .slot = 1, .val_index = 0, .head = root(90) }, .authenticated = true },
        .{ .vote = .{ .slot = 1, .val_index = 0, .head = root(91) }, .authenticated = true },
        .{ .vote = .{ .slot = 1, .val_index = 1, .head = root(a) }, .authenticated = true },
    };
    const support = [_]Vote{ raw[3].vote, raw[0].vote, raw[3].vote, raw[2].vote };
    _ = try f.acceptPayload(33, 2, a, &.{ .votes = &raw, .support_votes = &support });
    try testing.expectEqual(@as(u32, 4), f.chain.pools[1].count);
    try f.at(36);
    try expectRoot(2, f.emitted[9].?.head);
}

test "votes outside the full committee leave AC state unchanged" {
    const f = try Fixture.create(3);
    defer f.destroy();
    try f.at(20);
    const before = try testing.allocator.create(Chain);
    defer testing.allocator.destroy(before);
    before.* = f.chain;
    for ([_]u32{ f.chain.config.validator_count, std.math.maxInt(u32) }) |validator| {
        try testing.expectEqual(Chain.Admission.invalid_validator, try f.chain.onMessage(21, &.{
            .slot = 1,
            .val_index = validator,
            .head = root(0),
        }));
        try expectSame(before, &f.chain);
    }
}

test "protocol admission distinguishes duplicate, stale, future, and equivocation limits" {
    const f = try Fixture.create(3);
    defer f.destroy();
    try f.at(20);
    var vote: Vote = .{ .slot = 1, .val_index = 0, .head = root(90) };
    try testing.expectEqual(Chain.Admission.accepted, try f.chain.onMessage(21, &vote));
    try testing.expectEqual(Chain.Admission.duplicate, try f.chain.onMessage(22, &vote));
    vote.head = root(91);
    try testing.expectEqual(Chain.Admission.accepted, try f.chain.onMessage(22, &vote));
    vote.head = root(92);
    try testing.expectEqual(Chain.Admission.equivocator_limit, try f.chain.onMessage(22, &vote));
    vote.val_index = 8;
    try testing.expectEqual(Chain.Admission.invalid_validator, try f.chain.onMessage(22, &vote));
    vote.val_index = 0;
    vote.slot = 2;
    try testing.expectEqual(Chain.Admission.future, try f.chain.onMessage(22, &vote));
    try f.at(32);
    vote.slot = 0;
    try testing.expectEqual(Chain.Admission.stale, try f.chain.onMessage(33, &vote));
    try testing.expectEqual(@as(u32, 21), f.chain.pools[1].buffer[1].timestamp);
}

test "AC rejects parameters that violate its protocol schedule or supported storage" {
    const f = try Fixture.create(3);
    defer f.destroy();
    var config = f.chain.config;
    config.k = 1;
    try testing.expectError(error.InvalidConfig, f.chain.init(&config));
    config = f.chain.config;
    config.delta = 0;
    try testing.expectError(error.InvalidConfig, f.chain.init(&config));
    config = f.chain.config;
    config.delta_f = 9;
    try testing.expectError(error.InvalidConfig, f.chain.init(&config));
}

test "identical moving frames and event inputs replay all meaningful AC state" {
    const a = try Fixture.create(3);
    defer a.destroy();
    const b = try Fixture.create(3);
    defer b.destroy();
    for ([_]*Fixture{ a, b }) |f| {
        const x = try f.accept(17, 1, 0);
        try f.cast(21, 1, 3, x);
        const y = try f.accept(33, 2, 0);
        try f.cast(37, 2, 3, y);
        try f.at(56);
        const view = try f.frame();
        try f.chain.restart(&view, 61);
        try f.at(100);
    }
    try expectSame(&a.chain, &b.chain);
    try testing.expectEqualDeep(a.emitted, b.emitted);
}

test "freeze excludes votes at equality while proposal lists pass that freeze" {
    for ([_]u32{ 27, 28, 29 }) |arrival| {
        const f = try Fixture.create(3);
        defer f.destroy();
        const a = try f.accept(17, 1, 0);
        const b = try f.accept(18, 1, 0);
        try f.cast(arrival, 1, 3, a);
        try f.at(36);
        try expectRoot(if (arrival < 28) a else b, f.emitted[9].?.head);
    }
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    _ = try f.accept(18, 1, 0);
    try f.cast(28, 1, 3, a);
    var raw: [3]ac.SignedVote = undefined;
    var support: [3]Vote = undefined;
    for (&raw, &support, 0..) |*signed, *vote, v| {
        vote.* = .{ .slot = 1, .val_index = @intCast(v), .head = root(a) };
        signed.* = .{ .vote = vote.*, .authenticated = true };
    }
    _ = try f.acceptPayload(33, 2, 0, &.{ .votes = &raw, .support_votes = &support });
    try f.at(36);
    try expectRoot(a, f.emitted[9].?.head);
}

test "late block witnesses use a strict freeze boundary" {
    for ([_]u32{ 43, 44, 45 }) |arrival| {
        const f = try Fixture.create(3);
        defer f.destroy();
        const a = try f.accept(17, 1, 0);
        const witness = try f.accept(arrival, 2, a);
        f.heads = @splat(false);
        f.heads[witness] = true;
        try f.at(52);
        try expectRoot(if (arrival < 44) witness else 0, f.emitted[13].?.head);
    }
}

test "equivocators support every head-walk block but no confirmation block" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const b = try f.accept(18, 1, 0);
    try f.cast(21, 1, 3, a);
    _ = try f.chain.onMessage(22, &.{
        .slot = 1,
        .val_index = 0,
        .head = root(b),
    });
    try f.at(31);
    const view = try f.frame();
    try expectRoot(a, try f.chain.head(&view, 31));
    try f.at(40);
    try expectRoot(0, f.chain.saved_confirmation[1].?);
    try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
}

test "equivocators and ancestor votes do not count as lock opponents" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const b = try f.accept(33, 2, 0);
    try f.cast(37, 2, 4, b);
    _ = try f.chain.onMessage(38, &.{
        .slot = 2,
        .val_index = 0,
        .head = root(0),
    });
    try f.at(52);
    try expectRoot(a, f.chain.locks.buffer[0].block);
    try testing.expectEqual(@as(u32, 84), f.chain.locks.buffer[0].deadline);
}

test "a missing confirmation breaks the slow window" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.at(37);
    for (0..6) |v| {
        _ = try f.chain.onMessage(37, &.{
            .slot = 2,
            .val_index = @intCast(v),
            .head = root(99),
        });
    }
    try f.cast(53, 3, 2, a);
    try f.at(88);
    try expectRoot(a, f.chain.saved_confirmation[1].?);
    try testing.expectEqual(@as(?Root, null), f.chain.saved_confirmation[2]);
    try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
    try f.at(104);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    try expectRoot(a, f.chain.locks.buffer[0].block);
}

test "rollback preserves distinct deadlines even when locks meet at F" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    try f.cast(37, 2, 3, a);
    const b = try f.accept(49, 3, 0);
    try f.cast(53, 3, 4, b);
    try f.at(68);
    try testing.expectEqual(@as(u32, 2), f.chain.locks.count);
    try expectRoot(0, f.chain.locks.buffer[0].block);
    try expectRoot(0, f.chain.locks.buffer[1].block);
    try testing.expectEqual(@as(u32, 84), f.chain.locks.buffer[0].deadline);
    try testing.expectEqual(@as(u32, 100), f.chain.locks.buffer[1].deadline);
    try f.at(84);
    var retained = false;
    for (f.chain.locks.constSlice()) |*lock| {
        try testing.expect(lock.deadline != 84);
        if (lock.deadline == 100) {
            try expectRoot(0, lock.block);
            retained = true;
        }
    }
    try testing.expect(retained);
}

test "F advancement clips the public record and does not immediately erase old locks" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const b = try f.accept(33, 2, 0);
    try f.at(40);
    var heads: Frame.Mask = @splat(false);
    heads[0] = true;
    const finalized = try Frame.init(f.blocks[b..][0..1], &root(b), &heads);
    try expectRoot(b, try f.chain.head(&finalized, 41));
    try expectRoot(b, try f.chain.confirmed(&finalized, 41));
    try expectRoot(a, f.chain.latest_confirmed);
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    for ([_]u32{ 44, 48, 52 }) |t| _ = try f.chain.onTick(&finalized, t);
    try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
}

test "an ancestor confirmation leaves the record unchanged while public confirmed steps back" {
    const f = try Fixture.create(64);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const descendant = try f.accept(33, 2, a);
    try f.cast(53, 3, 3, a);
    try f.at(56);
    try expectRoot(descendant, f.chain.latest_confirmed);
    try f.at(72);
    const view = try f.frame();
    try expectRoot(a, f.chain.saved_confirmation[3].?);
    try expectRoot(descendant, f.chain.latest_confirmed);
    try expectRoot(a, try f.chain.head(&view, 72));
    try expectRoot(a, try f.chain.confirmed(&view, 72));
}

test "confirmation walks from F even when the candidate lies outside the viable tree" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const b = try f.accept(18, 1, 0);
    f.fc_root = root(b);
    f.heads = @splat(false);
    f.heads[b] = true;
    try f.cast(21, 1, 3, a);
    try f.at(40);
    const view = try f.frame();
    try expectRoot(a, f.chain.saved_confirmation[1].?);
    try expectRoot(a, f.chain.latest_confirmed);
    try expectRoot(b, try f.chain.head(&view, 40));
    try expectRoot(0, try f.chain.confirmed(&view, 40));
}

test "FG source and anchor include viable ancestors of a nonviable fast-locked tip" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    const descendant = try f.accept(33, 2, a);
    try f.cast(37, 2, 3, descendant);
    try f.at(55);
    f.fc_root = root(a);
    f.heads = @splat(false);
    f.heads[a] = true;
    try f.at(56);
    const view = try f.frame();
    try expectRoot(descendant, f.chain.locks.buffer[0].block);
    try testing.expectEqual(@as(u32, 2), f.chain.fast_confirmed.count);
    const input = try f.chain.toFG(&view, 56);
    try expectRoot(a, input.fg_confirmed.?);
    try expectRoot(a, input.head);
    var proposal: Chain.Proposal = undefined;
    try f.at(64);
    try testing.expect(try f.chain.proposal(&view, 64, &proposal));
    try testing.expectEqual(try f.chain.head(&view, 64), proposal.parent);
}

test "full validator set admits two votes each without imposing the legacy committee bound" {
    const f = try Fixture.create(3);
    defer f.destroy();
    var config = f.chain.config;
    config.validator_count = limits.max_validators;
    config.validator_index = limits.max_validators - 1;
    try f.chain.init(&config);
    try f.at(4);
    for (0..limits.max_validators) |v| {
        const count: u32 = if (v == limits.max_validators - 1) 1 else 2;
        for (0..count) |i| {
            try testing.expectEqual(Chain.Admission.accepted, try f.chain.onMessage(5, &.{
                .slot = 0,
                .val_index = @intCast(v),
                .head = root(@intCast(100 + 2 * v + i)),
            }));
        }
    }
    try testing.expectEqual(max_votes, f.chain.pools[0].count);
    const view = try f.frame();
    try expectRoot(0, try f.chain.head(&view, 5));
    try f.at(24);
    try testing.expectEqual(@as(?Root, null), f.chain.saved_confirmation[0]);
}

test "merging proposal bodies larger than a vote set preserves equivocation without overflow" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    var raw: [max_votes]ac.SignedVote = undefined;
    for (0..2) |v| {
        for (&raw, 0..) |*signed, i| {
            signed.* = .{
                .vote = .{ .slot = 1, .val_index = @intCast(v), .head = root(@intCast(100 + i)) },
                .authenticated = true,
            };
        }
        _ = try f.acceptPayload(33 + @as(u32, @intCast(v)), 2, a, &.{ .votes = &raw });
    }
    try f.at(36);
    try expectRoot(3, f.emitted[9].?.head);
}

test "genesis identity is supplied by the environment rather than a synthetic root constant" {
    const f = try Fixture.create(3);
    defer f.destroy();
    var config = f.chain.config;
    config.genesis_root = root(999);
    try f.chain.init(&config);
    f.blocks[0].root = config.genesis_root;
    f.blocks[0].parent = config.genesis_root;
    f.fc_root = config.genesis_root;
    try f.at(4);
    try expectRoot(999, f.emitted[1].?.head);
    const view = try f.frame();
    try expectRoot(999, try f.chain.confirmed(&view, 4));
    try testing.expectEqual(@as(?u32, 4), f.chain.resolutionTime(&view, 0, &f.emitted[1].?));
}

test "block-history exhaustion reports a resource error before admitting carried votes" {
    const f = try Fixture.create(3);
    defer f.destroy();
    try f.at(17);
    for (1..limits.max_blocks + 1) |index| {
        const block: Frame.Block = .{
            .root = root(@intCast(index)),
            .parent = root(0),
            .slot = 1,
        };
        try f.chain.onBlock(17, &block);
    }
    const before = try testing.allocator.create(Chain);
    defer testing.allocator.destroy(before);
    before.* = f.chain;
    const raw = [_]ac.SignedVote{.{
        .vote = .{ .slot = 0, .val_index = 0, .head = root(0) },
        .authenticated = true,
    }};
    const block: Frame.Block = .{
        .root = root(limits.max_blocks + 1),
        .parent = root(0),
        .slot = 1,
        .payload = .{ .votes = &raw },
    };
    try testing.expectError(error.BlockCapacity, f.chain.onBlock(17, &block));
    try expectSame(before, &f.chain);
}

test "a late valid block is stamped even when its carried votes are stale" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const raw = [_]ac.SignedVote{.{
        .vote = .{ .slot = 0, .val_index = 0, .head = root(0) },
        .authenticated = true,
    }};
    const index = try f.acceptPayload(33, 1, 0, &.{ .votes = &raw });
    try testing.expectEqual(@as(u32, 33), f.chain.observations.buffer[0].timestamp);
    try expectRoot(index, f.chain.observations.buffer[0].root);
    try testing.expectEqual(@as(u32, 1), f.chain.pools[0].count);
    try testing.expectEqual(@as(u32, 7), f.chain.pools[0].buffer[0].vote.val_index);
}

test "expired locks do not anchor between wake and the next tick and expire exactly at deadline" {
    const f = try Fixture.create(3);
    defer f.destroy();
    const a = try f.accept(17, 1, 0);
    try f.cast(21, 1, 3, a);
    const b = try f.accept(33, 2, 0);
    try f.at(40);
    f.heads = @splat(false);
    f.heads[b] = true;
    try f.at(80);
    const view = try f.frame();
    try testing.expectEqual(@as(u32, 1), f.chain.locks.count);
    try expectRoot(b, try f.chain.head(&view, 83));
    try f.at(84);
    try testing.expectEqual(@as(u32, 0), f.chain.locks.count);
    try expectRoot(b, try f.chain.head(&view, 84));
    try expectRoot(0, try f.chain.confirmed(&view, 84));

    const sleeping = try Fixture.create(3);
    defer sleeping.destroy();
    const locked = try sleeping.accept(17, 1, 0);
    try sleeping.cast(21, 1, 3, locked);
    try sleeping.at(40);
    const wake_frame = try sleeping.frame();
    try sleeping.chain.restart(&wake_frame, 101);
    try testing.expectEqual(@as(u32, 1), sleeping.chain.locks.count);
    try expectRoot(0, try sleeping.chain.head(&wake_frame, 101));
    try expectRoot(0, try sleeping.chain.confirmed(&wake_frame, 101));
    try sleeping.at(104);
    try testing.expectEqual(@as(u32, 0), sleeping.chain.locks.count);
}

test "bounded moving-frame scripts satisfy the four AC interface requirements" {
    const f = try Fixture.create(3);
    defer f.destroy();
    for (1..13) |slot_index| {
        const s: u32 = @intCast(slot_index);
        const start = 16 * s;
        try f.at(start);
        const before = try f.frame();
        var proposal: Chain.Proposal = undefined;
        try testing.expect(try f.chain.proposal(&before, start, &proposal));
        try testing.expectEqual(try f.chain.head(&before, start), proposal.parent);
        const parent = before.find(&proposal.parent).?;
        const block = try f.acceptPayload(start + 1, s, parent, &.{
            .votes = proposal.votes.constSlice(),
            .support_votes = proposal.support_votes.constSlice(),
        });
        try f.cast(start + 5, s, 7, block);
        try f.at(start + 8);
        const view = try f.frame();
        const head = try f.chain.head(&view, start + 8);
        const confirmed = try f.chain.confirmed(&view, start + 8);
        const head_index = view.find(&head).?;
        try testing.expect(view.isAncestor(view.find(&view.fc_root).?, head_index));
        try testing.expect(view.isAncestor(view.find(&confirmed).?, head_index));
        try testing.expect(view.viable_heads[head_index]);
        try testing.expect(view.viable_heads[view.find(&f.emitted[(start + 4) / delta].?.head).?]);
        if ((start + 8 - 24) % 32 == 0) {
            const input = try f.chain.toFG(&view, start + 8);
            if (input.fg_confirmed) |source| {
                const source_index = view.find(&source).?;
                try testing.expect(view.viableTree(&view.all())[source_index]);
                try testing.expect(view.isAncestor(source_index, view.find(&input.head).?));
            }
        }
    }
}
