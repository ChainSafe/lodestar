const Catalog = @import("catalog.zig").Catalog;
const std = @import("std");
const p = @import("policy.zig");
const t = @import("types.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const options: Catalog.Options = .{ .capacity = 8, .outbound_reserve = 1, .target_peers = 2, .max_peers = 4, .min_outbound = 1 };

test "peer policy repeated equivalent arrivals preserve the healthy incumbent" {
    const configured: Catalog.Options = .{ .target_peers = 1, .max_peers = 2, .min_outbound = 0 };
    const incumbent: p.Input = .{ .peer = .{ .index = 1, .generation = 1 }, .connected_at_ms = 10, .coverage = .{ .attnets = 1 }, .score = -0.5 };
    for (0..32) |round| {
        const newcomer: p.Input = .{ .peer = .{ .index = 2, .generation = round + 1 }, .connected_at_ms = 100 + round, .coverage = .{ .attnets = 1 }, .score = 0.5, .outbound = true };
        const inputs = if (round % 2 == 0) [_]p.Input{ incumbent, newcomer } else [_]p.Input{ newcomer, incumbent };
        const result = p.select(&inputs, &.{ .attnets = 1 }, configured, round);
        try equal(@as(u16, 1), result.retained_count);
        try expect(result.retained.isSet(round % 2));
        try equal(t.DisconnectReason.count_pruning, result.reasons[1 - round % 2].?);
        try equal(@as(u16, 0), result.deficits.attestation);
    }
}

test "peer policy tenure yields to useful coverage healthy service and outbound floor" {
    var configured: Catalog.Options = .{ .target_peers = 1, .max_peers = 2, .min_outbound = 0 };
    var inputs = [_]p.Input{
        .{ .connected_at_ms = 10, .coverage = .{ .attnets = 1 } },
        .{ .connected_at_ms = 100, .coverage = .{ .attnets = 3 }, .outbound = true },
    };
    var result = p.select(&inputs, &.{ .attnets = 3 }, configured, 1);
    try expect(result.retained.isSet(1));
    try equal(@as(u16, 0), result.deficits.attestation);
    inputs[1].coverage.attnets = 1;
    inputs[0].score = -3;
    result = p.select(&inputs, &.{ .attnets = 1 }, configured, 1);
    try expect(result.retained.isSet(1));
    inputs[0].score = 0;
    inputs[0].ready = false;
    result = p.select(&inputs, &.{ .attnets = 1 }, configured, 1);
    try expect(result.retained.isSet(1));
    inputs[0].ready = true;
    configured.min_outbound = 1;
    result = p.select(&inputs, &.{ .attnets = 1 }, configured, 1);
    try expect(result.retained.isSet(1));
    try equal(@as(u16, 0), result.deficits.outbound);
}

test "peer policy equal admission times break ties independently of snapshot order" {
    const configured: Catalog.Options = .{ .target_peers = 1, .max_peers = 3, .min_outbound = 0 };
    const inputs = [_]p.Input{
        .{ .peer = .{ .index = 100, .generation = 1 }, .connected_at_ms = 10 },
        .{ .peer = .{ .index = 8, .generation = 2 }, .connected_at_ms = 10 },
        .{ .peer = .{ .index = 3, .generation = 1 }, .connected_at_ms = 10 },
    };
    const baseline = p.select(&inputs, &.{}, configured, 1);
    const winner = inputs[baseline.retained.findFirstSet().?].peer;
    for ([_][3]usize{ .{ 0, 2, 1 }, .{ 1, 0, 2 }, .{ 1, 2, 0 }, .{ 2, 0, 1 }, .{ 2, 1, 0 } }) |order| {
        const reordered = [_]p.Input{ inputs[order[0]], inputs[order[1]], inputs[order[2]] };
        const result = p.select(&reordered, &.{}, configured, 1);
        try equal(@as(u16, 1), result.retained_count);
        try equal(winner, reordered[result.retained.findFirstSet().?].peer);
    }
}

test "peer policy separates sampling routes from custody service deficits" {
    var demand: t.Demand = .{};
    var input: p.Input = .{};
    for (0..8) |group| {
        demand.group_targets[group] = 1;
        demand.custody_group_targets[group] = 1;
        input.coverage.groups.set(group);
        if (group < 4) input.coverage.custody_groups.set(group);
    }
    const result = p.select(&.{input}, &demand, .{ .target_peers = 1, .max_peers = 2, .min_outbound = 0 }, 1);
    try equal(@as(u16, 0), result.deficits.groups);
    try equal(@as(u16, 4), result.deficits.custody_groups);
    try equal(@as(u16, 1), result.dial_budget);
    for (0..8) |group| try equal(group >= 4, result.deficits.missing.custody_groups.isSet(group));
}

test "peer policy protects scarce custodians and duties before broad publication redundancy" {
    var demand: t.Demand = .{ .attnets = 1, .group_targets = @splat(1) };
    demand.custody_group_targets[0] = 1;
    var inputs = [_]p.Input{ .{}, .{ .coverage = .{ .attnets = 1 } }, .{ .coverage = .{ .groups = .full } } };
    inputs[0].coverage.custody_groups.set(0);
    const result = p.select(&inputs, &demand, .{ .target_peers = 2, .max_peers = 4, .min_outbound = 0 }, 1);
    try expect(result.retained.isSet(0));
    try expect(result.retained.isSet(1));
    try expect(!result.retained.isSet(2));
    try equal(@as(u16, 0), result.deficits.custody_groups);
    try equal(@as(u16, 0), result.deficits.attestation);
    try equal(@as(u16, 128), result.deficits.groups);
}

test "peer policy prefers stable subscribers without denying temporary duty coverage" {
    var inputs = [_]p.Input{ .{ .coverage = .{ .attnets = 1 }, .stable = .{ .attnets = 1 } }, .{ .coverage = .{ .attnets = 1 } } };
    const configured: Catalog.Options = .{ .target_peers = 1, .max_peers = 3, .min_outbound = 0 };
    var result = p.select(&inputs, &.{ .attnets = 1 }, configured, 2);
    try expect(result.retained.isSet(0));
    inputs[0].coverage = .{};
    inputs[0].stable = .{};
    result = p.select(&inputs, &.{ .attnets = 1 }, configured, 2);
    try expect(result.retained.isSet(1));
    try equal(@as(u16, 0), result.deficits.attestation);
}

test "peer policy replacement cooldown preserves unmet deficits and independent count floors" {
    const configured: Catalog.Options = .{ .target_peers = 2, .max_peers = 3, .min_outbound = 0 };
    const inputs = [_]p.Input{ .{}, .{} };
    const held = p.selectWithPacing(&inputs, &.{ .attnets = 1 }, configured, 1, false);
    try equal(@as(u16, 2), held.retained_count);
    try equal(@as(u16, 1), held.deficits.attestation);
    try equal(@as(u16, 0), held.dial_budget);
    const replace = p.selectWithPacing(&inputs, &.{ .attnets = 1 }, configured, 1, true);
    try equal(@as(u16, 2), replace.retained_count);
    try equal(@as(u16, 1), replace.dial_budget);
    const refill = p.selectWithPacing(inputs[0..1], &.{}, configured, 1, false);
    try equal(@as(u16, 1), refill.dial_budget);
    var outbound_options = configured;
    outbound_options.min_outbound = 1;
    const outbound = p.selectWithPacing(&inputs, &.{}, outbound_options, 1, false);
    try equal(@as(u16, 1), outbound.deficits.outbound);
    try equal(@as(u16, 1), outbound.dial_budget);
}

test "peer policy does not sacrifice satisfied duties to chase broad publication at the ceiling" {
    var demand: t.Demand = .{ .attnets = 3 };
    demand.group_targets[5] = 1;
    const inputs = [_]p.Input{ .{ .coverage = .{ .attnets = 1 } }, .{ .coverage = .{ .attnets = 2 } } };
    const configured: Catalog.Options = .{ .target_peers = 2, .max_peers = 3, .min_outbound = 0 };
    const held = p.select(&inputs, &demand, configured, 1);
    try equal(@as(u16, 2), held.retained_count);
    try equal(@as(u16, 0), held.deficits.attestation);
    try equal(@as(u16, 1), held.deficits.groups);
    try equal(@as(u16, 1), held.dial_budget);
    demand.attnets = 1;
    const replace = p.select(&inputs, &demand, configured, 1);
    try equal(@as(u16, 2), replace.retained_count);
    try expect(replace.retained.isSet(0));
    try equal(@as(u16, 1), replace.dial_budget);
}
test "peer policy coverage cannot pin the connection ceiling with unmet demand" {
    const configured: Catalog.Options = .{ .target_peers = 2, .max_peers = 3, .min_outbound = 1 };
    const inputs = [_]p.Input{
        .{ .coverage = .{ .attnets = 1 } },
        .{ .coverage = .{ .attnets = 2 } },
        .{ .coverage = .{ .attnets = 4 } },
    };
    const result = p.select(&inputs, &.{ .attnets = 15 }, configured, 1);
    try equal(@as(u16, 2), result.retained_count);
    try equal(@as(u16, 1), result.dial_budget);
    try equal(@as(u16, 1), result.deficits.outbound);
    try equal(@as(u64, 8), result.deficits.missing.attnets & 8);
}

test "peer policy poor health precedes redundant advertised breadth" {
    const configured: Catalog.Options = .{ .target_peers = 2, .max_peers = 3, .min_outbound = 0 };
    const inputs = [_]p.Input{
        .{ .coverage = .{ .attnets = 1 } },
        .{ .coverage = .{ .attnets = 2 } },
        .{ .coverage = .{ .attnets = 3 }, .score = -10 },
    };
    const result = p.select(&inputs, &.{ .attnets = 3 }, configured, 1);
    try expect(result.retained.isSet(0));
    try expect(result.retained.isSet(1));
    try expect(!result.retained.isSet(2));
    try equal(@as(u16, 0), result.deficits.attestation);
}

test "peer policy coverage trials retain the steady target while using headroom" {
    const configured: Catalog.Options = .{ .target_peers = 2, .max_peers = 3, .min_outbound = 0 };
    const inputs = [_]p.Input{ .{ .coverage = .{ .attnets = 1 } }, .{ .coverage = .{ .attnets = 2 } } };
    const demand: t.Demand = .{ .attnets = 7 };
    const result = p.select(&inputs, &demand, configured, 1);
    try equal(@as(u16, 2), result.retained_count);
    try equal(@as(u16, 1), result.dial_budget);
    try equal(@as(u16, 1), result.deficits.attestation);
    for (result.reasons[0..inputs.len]) |reason| try expect(reason == null);
}

test "peer policy evaluates newcomers in headroom before pruning established peers" {
    const configured: Catalog.Options = .{ .target_peers = 2, .max_peers = 3, .min_outbound = 1 };
    var inputs = [_]p.Input{
        .{ .coverage = .{ .attnets = 1 }, .outbound = true },
        .{ .coverage = .{ .attnets = 2 } },
        .{ .ready = false, .qualified = false, .evaluating = true },
    };
    var result = p.select(&inputs, &.{ .attnets = 7 }, configured, 1);
    try equal(@as(u16, 3), result.retained_count);
    try equal(@as(u16, 0), result.dial_budget);
    for (result.reasons) |reason| try expect(reason == null);
    inputs[2].evaluating = false;
    result = p.select(&inputs, &.{ .attnets = 7 }, configured, 1);
    try equal(@as(u16, 2), result.retained_count);
    try expect(result.retained.isSet(0));
    try expect(result.retained.isSet(1));
    try equal(t.DisconnectReason.count_pruning, result.reasons[2].?);
    try equal(@as(u16, 1), result.dial_budget);
}

test "peer policy ordinary negative scores preserve scarce coverage" {
    const configured: Catalog.Options = .{ .target_peers = 1, .max_peers = 3, .min_outbound = 0 };
    const inputs = [_]p.Input{
        .{ .coverage = .{ .attnets = 1 }, .score = -0.5 },
        .{},
    };
    const result = p.select(&inputs, &.{ .attnets = 1 }, configured, 1);
    try expect(result.retained.isSet(0));
    try equal(@as(u16, 0), result.deficits.attestation);
}

test "peer policy overlapping coverage updates after each removal" {
    var demand: t.Demand = .{ .attnets = 1, .syncnets = 1 };
    demand.group_targets[5] = 1;
    var inputs = [_]p.Input{
        .{ .coverage = .{ .attnets = 1, .syncnets = 1 }, .outbound = true },
        .{ .coverage = .{ .attnets = 1, .syncnets = 1 }, .outbound = true },
        .{},
        .{},
        .{},
    };
    const only_custody_peer = 2;
    inputs[only_custody_peer].coverage.groups.set(5);
    const result = p.select(&inputs, &demand, options, 7);
    try equal(@as(u16, 0), result.deficits.sync);
    try expect(result.retained.isSet(only_custody_peer));
    try expect(result.retained_count <= options.max_peers);
    try equal(@as(u16, 2), result.retained_count);
    try expect(result.retained.isSet(0) != result.retained.isSet(1));
}

test "peer policy direct bans hard capacity deficits and outbound replacement" {
    var configured = options;
    configured.max_peers = 2;
    configured.target_peers = 1;
    const demand: t.Demand = .{};
    const inputs = [_]p.Input{ .{ .direct = true, .reject = .banned }, .{ .direct = true, .reject = .incompatible_fork }, .{ .direct = true }, .{ .direct = true }, .{ .direct = true } };
    var result = p.select(&inputs, &demand, configured, 3);
    try equal(t.DisconnectReason.banned, result.reasons[0].?);
    try equal(t.DisconnectReason.incompatible_fork, result.reasons[1].?);
    try equal(@as(u16, 2), result.retained_count);
    try equal(@as(u16, 1), result.deficits.outbound);
    try equal(@as(u16, 0), result.dial_budget);
    const inbound = [_]p.Input{ .{}, .{} };
    result = p.select(&inbound, &demand, options, 3);
    try equal(@as(u16, 1), result.dial_budget);
    result = p.select(&inbound, &demand, configured, 3);
    try equal(@as(u16, 1), result.retained_count);
    try equal(@as(u16, 1), result.dial_budget);
}

test "peer policy finite ranking demand replacement and infeasible demanded coverage" {
    var demand: t.Demand = .{ .attnets = 1, .syncnets = 1, .attestation_target = 2 };
    const inputs = [_]p.Input{ .{ .score = std.math.nan(f64) }, .{ .coverage = .{ .attnets = 1 }, .outbound = true }, .{ .direct = true } };
    var result = p.select(&inputs, &demand, options, 7);
    try equal(@as(u16, 1), result.deficits.attestation);
    try equal(@as(u16, 1), result.deficits.sync);
    try expect(result.retained.isSet(1));
    try equal(@as(u16, 1), result.dial_budget);
    demand = .{};
    result = p.select(&inputs, &demand, options, 7);
    try equal(@as(u16, 0), result.deficits.attestation);
    try equal(@as(u16, 0), result.deficits.sync);
    try equal(@as(u16, 0), result.dial_budget);
    try std.testing.expectError(error.InvalidDemand, (t.Demand{ .sync_target = 0 }).validate(&.{}, 4));
    demand.group_targets[64] = 1;
    try std.testing.expectError(error.InvalidDemand, demand.validate(&.{ .custody_groups = 64 }, 4));
}

test "peer policy retained set stays stable across health changes after actual pruning" {
    const demand: t.Demand = .{ .attnets = 1, .syncnets = 1 };
    const original = [_]p.Input{
        .{ .coverage = .{ .attnets = 1 }, .score = -10 },
        .{ .coverage = .{ .syncnets = 1 }, .score = -9 },
        .{ .outbound = true, .score = -8 },
        .{ .score = -7 },
    };
    var configured = options;
    configured.target_peers = 1;
    const first = p.select(&original, &demand, configured, 7);
    try equal(configured.target_peers, first.retained_count);
    try equal(@as(u16, 0), first.deficits.outbound);
    try expect(first.reasons[3] != null);
    var retained: [4]p.Input = undefined;
    var count: usize = 0;
    for (original, 0..) |input, index| if (first.retained.isSet(index)) {
        retained[count] = input;
        count += 1;
    };
    for (0..8) |permutation| {
        for (retained[0..count], 0..) |*input, index| input.score = if (permutation & (@as(usize, 1) << @intCast(index)) != 0) -1e6 else 1e6;
        const next = p.select(retained[0..count], &demand, configured, 7);
        try equal(first.retained_count, next.retained_count);
        try equal(first.deficits, next.deficits);
        for (next.reasons[0..count]) |reason| try expect(reason == null);
    }

    configured.target_peers = configured.max_peers - 1;
    const inbound = [_]p.Input{ .{ .score = -10 }, .{ .score = -9 }, .{ .score = -8 }, .{ .score = -7 } };
    const replacement = p.select(&inbound, &.{}, configured, 7);
    try equal(@as(u16, 3), replacement.retained_count);
    count = 0;
    for (inbound, 0..) |input, index| if (replacement.retained.isSet(index)) {
        retained[count] = input;
        retained[count].score = -input.score;
        count += 1;
    };
    const stable = p.select(retained[0..count], &.{}, configured, 7);
    try equal(replacement.retained_count, stable.retained_count);
    try equal(replacement.deficits, stable.deficits);
    try equal(@as(u16, 1), stable.dial_budget);
}

test "peer policy explicit group targets match Hoodi sampling deficits" {
    var demand: t.Demand = .{ .group_targets = @splat(4) };
    var inputs = [_]p.Input{.{}};
    for ([_]u8{ 1, 17, 19, 42, 75, 87, 102, 117 }) |group| {
        demand.group_targets[group] = 6;
        inputs[0].coverage.groups.set(group);
    }
    const configured: Catalog.Options = .{ .capacity = 256, .max_peers = 256, .target_peers = 1, .min_outbound = 0 };
    const result = p.select(&inputs, &demand, configured, 1);
    try equal(@as(u16, 520), result.deficits.groups);
    try equal(@as(usize, 128), result.deficits.missing.groups.count());
    for (0..128) |group| {
        var one: t.Demand = .{};
        one.group_targets[group] = demand.group_targets[group];
        try equal(@as(u16, if (inputs[0].coverage.groups.isSet(group)) 5 else 4), p.select(&inputs, &one, configured, 1).deficits.groups);
    }
    try equal(@as(u16, 0), p.select(&inputs, &.{}, configured, 1).deficits.groups);
}

test "peer policy group targets validate boundaries and saturate exactly" {
    var demand: t.Demand = .{ .attnets = 3, .syncnets = 2 };
    demand.group_targets[0] = 1;
    demand.group_targets[127] = 256;
    try demand.validate(&.{ .custody_groups = 128 }, 256);
    try equal(@as(usize, 2), demand.wanted().groups.count());
    try equal(@as(u64, 3), demand.wanted().attnets);
    try equal(@as(u4, 2), demand.wanted().syncnets);
    demand.group_targets[127] = 257;
    try std.testing.expectError(error.InvalidDemand, demand.validate(&.{}, 256));
    demand.group_targets[127] = 1;
    try std.testing.expectError(error.InvalidDemand, demand.validate(&.{ .custody_groups = 64 }, 256));
    demand = .{ .group_targets = @splat(256) };
    const configured: Catalog.Options = .{ .capacity = 256, .max_peers = 256, .target_peers = 255, .min_outbound = 0 };
    try equal(@as(u16, 32768), p.select(&.{}, &demand, configured, 1).deficits.groups);
    var inputs: [256]p.Input = @splat(.{ .evaluating = true });
    for (&inputs) |*input| input.coverage.groups.setRangeValue(.{ .start = 0, .end = 128 }, true);
    try equal(@as(u16, 0), p.select(&inputs, &demand, configured, 1).deficits.groups);
    try equal(@as(u16, 128), p.select(inputs[0..255], &demand, configured, 1).deficits.groups);
    demand = .{};
    try equal(@as(u16, 0), p.select(&inputs, &demand, configured, 1).deficits.groups);
}

test "peer policy group targets yield to settled count while respecting bans" {
    var demand: t.Demand = .{};
    demand.group_targets[5] = 2;
    demand.group_targets[9] = 1;
    var inputs: [4]p.Input = @splat(.{});
    inputs[0].coverage.groups.set(5);
    inputs[1].coverage.groups.set(5);
    inputs[2].coverage.groups.set(5);
    inputs[3].coverage.groups.set(9);
    var configured = options;
    configured.target_peers = 2;
    configured.max_peers = 3;
    configured.min_outbound = 0;
    var result = p.select(&inputs, &demand, configured, 1);
    try equal(@as(u16, 2), result.retained_count);
    try equal(@as(u16, 1), result.deficits.groups);
    configured.max_peers = 2;
    configured.target_peers = 1;
    result = p.select(&inputs, &demand, configured, 1);
    try equal(@as(u16, 1), result.retained_count);
    try equal(@as(u16, 2), result.deficits.groups);
    inputs[3].reject = .banned;
    result = p.select(&inputs, &demand, configured, 1);
    try equal(t.DisconnectReason.banned, result.reasons[3].?);
    try expect(result.deficits.missing.groups.isSet(9));
}

test "peer policy unqualified connections occupy room without meeting peer targets" {
    const configured: Catalog.Options = .{ .target_peers = 3, .max_peers = 5, .min_outbound = 2 };
    var inputs = [_]p.Input{
        .{ .outbound = true },
        .{ .outbound = true, .qualified = false, .ready = false },
        .{ .qualified = false, .ready = false },
    };
    var result = p.select(&inputs, &.{}, configured, 1);
    try equal(@as(u16, 3), result.retained_count);
    try equal(@as(u16, 1), result.qualified_count);
    try equal(@as(u16, 1), result.deficits.outbound);
    try equal(@as(u16, 2), result.dial_budget);
    inputs[1].qualified = true;
    inputs[2].qualified = true;
    result = p.select(&inputs, &.{}, configured, 1);
    try equal(@as(u16, 3), result.qualified_count);
    try equal(@as(u16, 0), result.dial_budget);
    try equal(@as(u16, 0), result.deficits.outbound);
}
