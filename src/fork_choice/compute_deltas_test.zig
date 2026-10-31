//! Tests for `compute_deltas.zig`.

const std = @import("std");
const testing = std.testing;
const vote_tracker = @import("vote_tracker.zig");
const Votes = vote_tracker.Votes;
const NULL_VOTE_INDEX = vote_tracker.NULL_VOTE_INDEX;
const compute_deltas = @import("compute_deltas.zig");
const ComputeDeltasResult = compute_deltas.ComputeDeltasResult;
const DeltasCache = compute_deltas.DeltasCache;
const EquivocatingIndices = compute_deltas.EquivocatingIndices;
const VoteIndex = compute_deltas.VoteIndex;
const computeDeltas = compute_deltas.computeDeltas;

const TestContext = struct {
    dc: DeltasCache = .empty,
    votes: Votes = .{},

    fn init(count: usize) !TestContext {
        var ctx: TestContext = .{};
        try ctx.votes.ensureValidatorCount(testing.allocator, @intCast(count));
        return ctx;
    }

    fn deinit(self: *TestContext) void {
        self.votes.deinit(testing.allocator);
        self.dc.deinit(testing.allocator);
    }

    fn run(
        self: *TestContext,
        num_nodes: u32,
        old_bal: []const u16,
        new_bal: []const u16,
        eq: *const EquivocatingIndices,
    ) !ComputeDeltasResult {
        const f = self.votes.fields();
        return computeDeltas(testing.allocator, &self.dc, num_nodes, f.current_indices, f.next_indices, old_bal, new_bal, eq);
    }

    // No deinit needed: init performs no allocation, so there is nothing to free.
    const empty_eq: EquivocatingIndices = .empty;
};

fn expectDeltas(actual: []const i64, expected: []const i64) !void {
    try testing.expectEqualSlices(i64, expected, actual);
}

test "zero hash" {
    const n = 16;
    var ctx = try TestContext.init(n);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, 0);

    const result = try ctx.run(n, &([_]u16{0} ** n), &([_]u16{0} ** n), &TestContext.empty_eq);
    try expectDeltas(result.deltas, &([_]i64{0} ** n));
    // current_indices should be updated to match next_indices
    try testing.expectEqualSlices(VoteIndex, f.next_indices, f.current_indices);
}

test "all voted the same" {
    const n = 16;
    var ctx = try TestContext.init(n);
    defer ctx.deinit();

    @memset(ctx.votes.fields().next_indices, 0);

    const bal = [_]u16{42} ** n;
    const result = try ctx.run(n, &bal, &bal, &TestContext.empty_eq);

    var expected = [_]i64{0} ** n;
    expected[0] = 42 * n;
    try expectDeltas(result.deltas, &expected);
}

test "different votes" {
    const n = 16;
    var ctx = try TestContext.init(n);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    for (0..n) |i| f.next_indices[i] = @intCast(i);

    const bal = [_]u16{42} ** n;
    const result = try ctx.run(n, &bal, &bal, &TestContext.empty_eq);
    try expectDeltas(result.deltas, &([_]i64{42} ** n));
}

test "moving votes" {
    const n = 16;
    var ctx = try TestContext.init(n);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, 1);

    const bal = [_]u16{42} ** n;
    const result = try ctx.run(n, &bal, &bal, &TestContext.empty_eq);

    var expected = [_]i64{0} ** n;
    expected[0] = -42 * n;
    expected[1] = 42 * n;
    try expectDeltas(result.deltas, &expected);
}

test "changing balances" {
    const n = 16;
    var ctx = try TestContext.init(n);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, 1);

    const result = try ctx.run(n, &([_]u16{42} ** n), &([_]u16{84} ** n), &TestContext.empty_eq);

    var expected = [_]i64{0} ** n;
    expected[0] = -42 * n;
    expected[1] = 84 * n;
    try expectDeltas(result.deltas, &expected);
}

test "validator appears" {
    var ctx = try TestContext.init(2);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, 1);

    // Only one validator in old balances, two in new
    const result = try ctx.run(2, &.{42}, &.{ 42, 42 }, &TestContext.empty_eq);
    try expectDeltas(result.deltas, &.{ -42, 84 });
    try testing.expectEqualSlices(VoteIndex, f.next_indices, f.current_indices);
}

test "validator disappears" {
    var ctx = try TestContext.init(2);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, 1);

    // Two validators in old balances, only one in new
    const result = try ctx.run(2, &.{ 42, 42 }, &.{42}, &TestContext.empty_eq);
    try expectDeltas(result.deltas, &.{ -84, 42 });
    try testing.expectEqualSlices(VoteIndex, f.next_indices, f.current_indices);
}

test "not empty equivocation set" {
    var ctx = try TestContext.init(2);
    defer ctx.deinit();

    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, 1);

    const bal: []const u16 = &.{ 31, 32 };
    // 1st validator is part of an attester slashing
    var eq: EquivocatingIndices = .empty;
    defer eq.deinit(testing.allocator);
    try eq.put(testing.allocator, 0, {});

    // Should disregard the 1st validator due to attester slashing
    const r1 = try ctx.run(2, bal, bal, &eq);
    try expectDeltas(r1.deltas, &.{ -63, 32 });

    // Calling computeDeltas again should not have any effect on the weight
    const r2 = try ctx.run(2, bal, bal, &eq);
    try expectDeltas(r2.deltas, &.{ 0, 0 });
}

test "move out of tree" {
    var ctx = try TestContext.init(2);
    defer ctx.deinit();

    // Both validators move from node 0 to NULL (leave the tree).
    const f = ctx.votes.fields();
    @memset(f.current_indices, 0);
    @memset(f.next_indices, NULL_VOTE_INDEX);

    const bal: []const u16 = &.{ 42, 42 };
    const result = try ctx.run(1, bal, bal, &TestContext.empty_eq);
    // Both old balances deducted, no new balance added anywhere
    try expectDeltas(result.deltas, &.{-84});
}
