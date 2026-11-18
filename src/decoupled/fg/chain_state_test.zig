const std = @import("std");
const testing = std.testing;
const ChainState = @import("ChainState.zig");
const fg = @import("finality_types.zig");
const limits = @import("../limits.zig");

const config: fg.Config = .{ .B_gen = @splat(0), .n = 4, .K_W = 2, .delta_t = 3 };
const B_gen: fg.BlockRef = .{ .root = @splat(0), .slot = 0 };
fn root(n: u32) fg.Root {
    var result: fg.Root = @splat(0);
    std.mem.writeInt(u32, result[0..4], n, .little);
    return result;
}
fn rows(h: u32, T: u32, tau: bool, h_f: ?u32, T_f: ?u32) [3]fg.Attestation {
    var result: [3]fg.Attestation = undefined;
    for (&result, 0..) |*a, v| {
        a.* = .{
            .val_index = @intCast(v),
            .h = h,
            .T = root(T),
            .tau = tau,
            .h_f = h_f,
            .T_f = if (T_f) |value| root(value) else null,
        };
    }
    return result;
}
fn step(
    out: *ChainState,
    sigma: *const ChainState,
    s: u32,
    attestations: []const fg.Attestation,
) !void {
    const B: fg.Block = .{
        .root = root(s),
        .slot = s,
        .parent = sigma.L.root,
        .proposer = 0,
        .attestations = attestations,
    };
    try testing.expect(try ChainState.stateTransition(out, sigma, &B, 0, &config));
}

fn expectSame(a: *const ChainState, b: *const ChainState) !void {
    try testing.expectEqualDeep(a.L, b.L);
    try testing.expectEqual(a.s, b.s);
    try testing.expectEqual(a.h, b.h);
    try testing.expectEqualDeep(a.T_h, b.T_h);
    try testing.expectEqualDeep(a.J, b.J);
    try testing.expectEqual(a.h_j, b.h_j);
    try testing.expectEqualDeep(a.F, b.F);
    try testing.expectEqual(a.h_F, b.h_F);
    try testing.expectEqualDeep(a.target_participation, b.target_participation);
    try testing.expectEqualDeep(a.progress, b.progress);
    try testing.expectEqualDeep(a.pending_finality.constSlice(), b.pending_finality.constSlice());
    try testing.expectEqualDeep(a.finality_participation, b.finality_participation);
}

test "target quorums justify, advance once per block, and finalize pending entries" {
    var genesis: ChainState = undefined;
    genesis.init(&B_gen);
    const first = rows(1, 0, false, null, null);
    var s1: ChainState = undefined;
    try step(&s1, &genesis, 1, &first);
    try testing.expectEqual(@as(u32, 2), s1.h);
    try testing.expectEqual(@as(u32, 1), s1.h_j);
    try testing.expectEqual(root(1), s1.T_h.root);
    try testing.expectEqual(@as(u32, 1), s1.pending_finality.count);
    try testing.expectEqual(@as(u32, 0), s1.h_F);
    const second = rows(2, 1, false, 1, 0);
    var s2: ChainState = undefined;
    try step(&s2, &s1, 2, &second);
    try testing.expectEqual(@as(u32, 3), s2.h);
    try testing.expectEqual(@as(u32, 1), s2.h_F);
    try testing.expectEqual(@as(u32, 2), s2.h_j);
    try testing.expectEqual(@as(u32, 2), s2.pending_finality.buffer[0].j);
    const third = rows(3, 2, false, 2, 1);
    var s3: ChainState = undefined;
    try step(&s3, &s2, 3, &third);
    try testing.expectEqual(root(1), s3.F.root);
    try testing.expectEqual(@as(u32, 2), s3.h_F);
    try testing.expectEqual(root(2), s3.J.root);
    try testing.expectEqual(@as(u32, 4), s3.h);
    try testing.expectEqual(@as(u32, 1), genesis.h);
    try testing.expectEqual(@as(u32, 0), genesis.pending_finality.count);
}

test "progress counts timeouts once per validator and waits for delta_t" {
    var genesis: ChainState = undefined;
    genesis.init(&B_gen);
    const timeout = rows(1, 0, true, null, null);
    var s1: ChainState = undefined;
    try step(&s1, &genesis, 1, &timeout);
    try testing.expectEqual(@as(u32, 1), s1.h);
    try testing.expect(s1.progress[0]);
    try testing.expect(!s1.target_participation[0]);
    var s2: ChainState = undefined;
    try step(&s2, &s1, 2, &.{});
    try testing.expectEqual(@as(u32, 1), s2.h);
    var s3: ChainState = undefined;
    try step(&s3, &s2, 3, &.{});
    try testing.expectEqual(@as(u32, 2), s3.h);
    try testing.expectEqual(@as(u32, 0), s3.h_j);
    try testing.expectEqual(root(3), s3.T_h.root);
    var huge_delay = config;
    huge_delay.delta_t = std.math.maxInt(u32);
    const B: fg.Block = .{
        .root = root(4),
        .slot = 4,
        .parent = s1.L.root,
        .proposer = 0,
    };
    try testing.expect(try ChainState.stateTransition(&s2, &s1, &B, 0, &huge_delay));
    try testing.expectEqual(@as(u32, 1), s2.h);
}

test "target quorum wins before the timeout delay and rows cannot advance multiple heights" {
    var genesis: ChainState = undefined;
    genesis.init(&B_gen);
    var first = rows(1, 0, false, null, null);
    const repeated = [_]fg.Attestation{ first[0], first[0], first[1] };
    var s1: ChainState = undefined;
    try step(&s1, &genesis, 1, &repeated);
    try testing.expectEqual(@as(u32, 1), s1.h);
    first[0] = first[2];
    var s2: ChainState = undefined;
    try step(&s2, &s1, 2, &first);
    try testing.expectEqual(@as(u32, 2), s2.h);
    try testing.expectEqual(@as(u32, 1), s2.h_j);
    try testing.expectEqual(root(2), s2.T_h.root);
    for (s2.progress) |value| try testing.expect(!value);
}

test "all rows validate against the parent before any candidate write" {
    var genesis: ChainState = undefined;
    genesis.init(&B_gen);
    var candidate: ChainState = undefined;
    candidate.init(&B_gen);
    const before = candidate;
    const first = rows(1, 0, false, null, null);
    const next: fg.Attestation = .{ .val_index = 0, .h = 2, .T = root(1), .tau = false };
    const invalid = [_]fg.Attestation{ first[0], first[1], first[2], next };
    var B: fg.Block = .{
        .root = root(1),
        .slot = 1,
        .parent = root(0),
        .proposer = 0,
        .attestations = &invalid,
    };
    try testing.expect(!try ChainState.stateTransition(&candidate, &genesis, &B, 0, &config));
    try expectSame(&before, &candidate);
    B.attestations = &first;
    B.proposer = 1;
    try testing.expect(!try ChainState.stateTransition(&candidate, &genesis, &B, 0, &config));
    B.proposer = 0;
    B.slot = 0;
    try testing.expect(!try ChainState.stateTransition(&candidate, &genesis, &B, 0, &config));
    try expectSame(&before, &candidate);
}

test "old votes with useful pending finality remain valid without changing current progress" {
    var s0: ChainState = undefined;
    s0.init(&B_gen);
    var s1: ChainState = undefined;
    try step(&s1, &s0, 1, &rows(1, 0, false, null, null));
    var s2: ChainState = undefined;
    try step(&s2, &s1, 2, &rows(2, 1, false, null, null));
    const old = rows(2, 99, true, 1, 0);
    try testing.expect(s2.validAttestation(&old[0]));
    var s3: ChainState = undefined;
    try step(&s3, &s2, 3, &old);
    try testing.expectEqual(@as(u32, 3), s3.h);
    try testing.expectEqual(@as(u32, 1), s3.h_F);
    for (s3.progress) |value| try testing.expect(!value);
    var invalid = old[0];
    invalid.h = 3;
    try testing.expect(!s2.validAttestation(&invalid));
    invalid = old[0];
    invalid.T_f = root(99);
    try testing.expect(!s2.validAttestation(&invalid));
}

test "pending window retains newest K_W entries and evicted evidence cannot finalize" {
    var states: [5]ChainState = undefined;
    states[0].init(&B_gen);
    for (1..5) |i| {
        try step(
            &states[i],
            &states[i - 1],
            @intCast(i),
            &rows(@intCast(i), @intCast(i - 1), false, null, null),
        );
    }
    const sigma = &states[4];
    try testing.expectEqual(@as(u32, 2), sigma.pending_finality.count);
    try testing.expectEqual(@as(u32, 3), sigma.pending_finality.buffer[0].j);
    try testing.expectEqual(@as(u32, 4), sigma.pending_finality.buffer[1].j);
    const evicted = rows(2, 99, false, 1, 0);
    try testing.expect(!sigma.validAttestation(&evicted[0]));
}

test "simultaneous finality quorums choose the greatest pending height" {
    var s0: ChainState = undefined;
    s0.init(&B_gen);
    var s1: ChainState = undefined;
    try step(&s1, &s0, 1, &rows(1, 0, false, null, null));
    var s2: ChainState = undefined;
    try step(&s2, &s1, 2, &rows(2, 1, false, null, null));
    const first = rows(3, 2, true, 1, 0);
    const second = rows(3, 2, true, 2, 1);
    const both = first ++ second;
    var s3: ChainState = undefined;
    try step(&s3, &s2, 3, &both);
    try testing.expectEqual(@as(u32, 2), s3.h_F);
    try testing.expectEqual(root(1), s3.F.root);
    try testing.expectEqual(@as(u32, 0), s3.pending_finality.count);
}

test "strict slots and single advancement keep reachable heights inside indexed storage" {
    var states: [2]ChainState = undefined;
    states[0].init(&B_gen);
    for (1..limits.max_slots) |s| {
        try step(
            &states[s % 2],
            &states[(s - 1) % 2],
            @intCast(s),
            &rows(@intCast(s), @intCast(s - 1), false, null, null),
        );
    }
    const last = &states[(limits.max_slots - 1) % 2];
    try testing.expectEqual(limits.max_slots, last.h);
    try testing.expect(last.h < limits.max_heights);
    const B: fg.Block = .{
        .root = root(limits.max_slots),
        .parent = last.L.root,
        .slot = limits.max_slots,
        .proposer = 0,
    };
    var out: ChainState = undefined;
    try testing.expectError(
        error.SlotCapacity,
        ChainState.stateTransition(&out, last, &B, 0, &config),
    );
}

test "slot and input-list bounds fail as capacity errors" {
    var sigma: ChainState = undefined;
    sigma.init(&B_gen);
    var out: ChainState = undefined;
    var B: fg.Block = .{
        .root = root(1),
        .parent = root(0),
        .slot = limits.max_slots,
        .proposer = 0,
    };
    try testing.expectError(
        error.SlotCapacity,
        ChainState.stateTransition(&out, &sigma, &B, 0, &config),
    );
    const oversized = try testing.allocator.alloc(
        fg.Attestation,
        limits.max_attestations_per_block + 1,
    );
    defer testing.allocator.free(oversized);
    B.slot = 1;
    B.attestations = oversized;
    try testing.expectError(
        error.AttestationCapacity,
        ChainState.stateTransition(&out, &sigma, &B, 0, &config),
    );
}
