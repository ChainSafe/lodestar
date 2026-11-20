const std = @import("std");
const r = @import("reputation.zig");
const t = @import("types.zig");
test "peer reputation normalizes gossip for selection without overriding RPC bans" {
    try std.testing.expectEqual(@as(f64, -19), r.selectionScore(0, -16000, -16000));
    try std.testing.expectEqual(@as(f64, -19), r.selectionScore(0, -8000, -8000));
    try std.testing.expectEqual(@as(f64, -10), r.selectionScore(-10, 0, -16000));
    try std.testing.expect(r.selectionScore(0, -100, -16000) > r.prune_score);
    try std.testing.expectEqual(r.ban_score, r.selectionScore(r.ban_score, 1e6, -16000));
    try std.testing.expectEqual(@as(f64, -10), r.selectionScore(-10, -100, 0));
}

test "peer reputation redial deadline is independent of admission and misconduct" {
    var state: r.State = .{};
    state.deferRedial(100, 300_000);
    try std.testing.expectEqual(@as(u64, 0), state.goodbye_until_ms);
    try std.testing.expectEqual(@as(f64, 0), state.score);
    try std.testing.expect(!state.banned(100));
    try std.testing.expect(state.retained(300_099));
    try std.testing.expect(!state.retained(300_100));
    try std.testing.expectEqual(@as(u64, 300_100), state.nextDeadline(100).?);
    try std.testing.expect(state.nextDeadline(300_100) == null);
    state.cooldown(200, 500);
    try std.testing.expectEqual(@as(u64, 700), state.nextDeadline(200).?);
    try std.testing.expectEqual(@as(u64, 300_100), state.nextDeadline(700).?);
}

test "peer reputation exact thresholds cooldown expiry and long gap" {
    var state: r.State = .{};
    try std.testing.expectEqual(t.ReputationDecision.none, state.apply(.low_tolerance, 0));
    try std.testing.expectEqual(t.ReputationDecision.disconnect, state.apply(.low_tolerance, 0));
    _ = state.apply(.low_tolerance, 0);
    _ = state.apply(.low_tolerance, 0);
    try std.testing.expectEqual(t.ReputationDecision.ban, state.apply(.low_tolerance, 0));
    state.decay(1_799_999);
    try std.testing.expectEqual(@as(f64, -50), state.score);
    try std.testing.expect(state.banned(1_799_999));
    try std.testing.expect(state.banned(1_800_000));
    state.decay(1_800_000);
    try std.testing.expectEqual(@as(f64, -50), state.score);
    state.decay(2_400_000);
    try std.testing.expectApproxEqAbs(@as(f64, -25), state.score, 0.00001);
    state.decay(std.math.maxInt(u64));
    try std.testing.expectEqual(@as(f64, 0), state.score);
}
test "peer reputation fatal clamps and goodbye has separate deadline" {
    var state: r.State = .{};
    _ = state.apply(.fatal, 100);
    _ = state.apply(.fatal, 100);
    try std.testing.expectEqual(@as(f64, -100), state.score);
    state.cooldown(200, 500);
    try std.testing.expectEqual(@as(u64, 700), state.goodbye_until_ms);
    try std.testing.expectEqual(@as(u64, 1_800_100), state.ban_until_ms);
    try std.testing.expect(state.retained(700));
}

test "peer reputation ban survives cooldown and exact threshold until further decay" {
    var state: r.State = .{};
    _ = state.apply(.fatal, 0);
    state.decay(1_800_000);
    try std.testing.expect(state.banned(1_800_000));
    state.decay(2_400_000);
    try std.testing.expectEqual(@as(f64, -50), state.score);
    try std.testing.expect(state.banned(2_400_000));
    state.decay(2_400_001);
    try std.testing.expect(!state.banned(2_400_001));
    state.decay(3_000_000);
    try std.testing.expectApproxEqAbs(@as(f64, -25), state.score, 0.00001);
}
test "peer reputation deadlines advance from cooldown through threshold to retention expiry" {
    var state: r.State = .{};
    _ = state.apply(.fatal, 0);
    try std.testing.expectEqual(@as(u64, 1_800_000), state.nextDeadline(0).?);
    try std.testing.expectEqual(@as(u64, 2_400_001), state.nextDeadline(1_800_000).?);
    const useful = state.nextDeadline(2_400_001).?;
    state.decay(useful);
    try std.testing.expect(state.score >= r.prune_score);
    const expiry = state.nextDeadline(useful).?;
    state.decay(expiry);
    try std.testing.expect(!state.retained(expiry));
    try std.testing.expect(state.nextDeadline(expiry) == null);
}

test "weak non-completion coalesces concurrency and bounds sustained failure" {
    var state: r.State = .{};
    for (0..128) |_| state.nonCompletion(100);
    try std.testing.expectEqual(@as(f64, -1), state.score);
    state.nonCompletion(10_099);
    try std.testing.expect(state.score > -1);
    state.nonCompletion(10_100);
    try std.testing.expect(state.score < -1.9);
    for (2..12) |i| state.nonCompletion(100 + i * 10_000);
    try std.testing.expectEqual(@as(f64, -4), state.score);
    try std.testing.expectEqual(@as(u64, 0), state.ban_until_ms);
    state.decay(110_100 + r.half_life_ms);
    try std.testing.expectApproxEqAbs(@as(f64, -2), state.score, 0.000001);
    state.nonCompletion(110_100 + r.half_life_ms);
    try std.testing.expectApproxEqAbs(@as(f64, -3), state.score, 0.000001);
}

test "weak non-completion never raises strong negative history or gates strong reports" {
    var state: r.State = .{};
    state.nonCompletion(100);
    try std.testing.expectEqual(t.ReputationDecision.none, state.apply(.low_tolerance, 100));
    state.nonCompletion(100);
    try std.testing.expectEqual(@as(f64, -11), state.score);
    try std.testing.expectEqual(t.ReputationDecision.disconnect, state.apply(.low_tolerance, 100));
    state.nonCompletion(10_100);
    try std.testing.expect(state.score < r.disconnect_score);
    try std.testing.expectEqual(@as(u64, 0), state.ban_until_ms);
}
