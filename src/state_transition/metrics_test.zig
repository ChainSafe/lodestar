const std = @import("std");
const metrics = @import("metrics.zig");
const init = metrics.init;
const deinit = metrics.deinit;
const write = metrics.write;

test "exports the expected metric names" {
    const state_transition = &metrics.state_transition;
    const allocator = std.testing.allocator;
    try init(allocator, std.testing.io, .{});
    defer deinit();

    try state_transition.process_block_step.observe(.{ .step = .processBlockHeader }, 0.001);
    try state_transition.process_operations_step.observe(.{ .step = .processAttestations }, 0.001);
    try state_transition.process_block.observe(.{ .source = .block }, 0.001);
    try state_transition.process_block.observe(.{ .source = .regen }, 0.001);
    try state_transition.process_block.observe(.{ .source = .get_historical_state }, 0.001);

    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();
    try write(&aw.writer);

    const expected = [_][]const u8{
        "lodestar_stfn_epoch_transition_seconds",
        "lodestar_stfn_epoch_transition_commit_seconds",
        "lodestar_stfn_epoch_transition_step_seconds",
        "lodestar_stfn_epoch_shuffling_job_seconds",
        "lodestar_stfn_process_block_seconds",
        "lodestar_stfn_process_block_step_seconds",
        "lodestar_stfn_process_operations_step_seconds",
        "lodestar_stfn_process_block_commit_seconds",
        "lodestar_stfn_hash_tree_root_seconds",
        "lodestar_stfn_effective_balance_updates_count",
        "lodestar_stfn_validators_in_activation_queue",
        "lodestar_stfn_validators_in_exit_queue",
        "lodestar_stfn_state_cloned_count",
        "lodestar_stfn_post_state_balances_nodes_populated_hit_total",
        "lodestar_stfn_post_state_balances_nodes_populated_miss_total",
        "lodestar_stfn_post_state_validators_nodes_populated_hit_total",
        "lodestar_stfn_post_state_validators_nodes_populated_miss_total",
        "lodestar_stfn_new_seen_attesters_per_block_total",
        "lodestar_stfn_new_seen_attesters_effective_balance_per_block_total",
        "lodestar_stfn_attestations_per_block_total",
        "lodestar_stfn_proposer_rewards_total",
        "lodestar_stfn_progressive_balances_mismatches_total",
        "validator_monitor_prev_epoch_on_chain_balance",
        "validator_monitor_prev_epoch_on_chain_source_attester_hit_total",
        "validator_monitor_prev_epoch_on_chain_source_attester_miss_total",
        "validator_monitor_prev_epoch_on_chain_head_attester_hit_total",
        "validator_monitor_prev_epoch_on_chain_head_attester_miss_total",
        "validator_monitor_prev_epoch_on_chain_target_attester_hit_total",
        "validator_monitor_prev_epoch_on_chain_target_attester_miss_total",
    };

    var names: std.ArrayList([]const u8) = .empty;
    defer names.deinit(allocator);
    var lines = std.mem.splitScalar(u8, aw.written(), '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, "# TYPE ")) continue;
        var parts = std.mem.splitScalar(u8, line["# TYPE ".len..], ' ');
        try names.append(allocator, parts.next().?);
    }

    try std.testing.expectEqual(expected.len, names.items.len);
    for (expected, names.items) |name, actual| {
        try std.testing.expectEqualStrings(name, actual);
    }

    try std.testing.expect(std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_step_seconds_count{step=\"processBlockHeader\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_process_operations_step_seconds_count{step=\"processAttestations\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_count{source=\"block\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_count{source=\"regen\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_count{source=\"get_historical_state\"} 1\n",
    ) != null);
    try std.testing.expect(std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_process_block_seconds_sum{source=\"block\"} 0.001\n",
    ) != null);
}

test "exports inclusive clone histogram buckets" {
    const state_transition = &metrics.state_transition;
    try init(std.testing.allocator, std.testing.io, .{});
    defer deinit();

    for ([_]u32{ 0, 1, 2, 3, 5, 6, 10, 11, 50, 51, 250, 251 }) |value| {
        state_transition.pre_state_cloned_count.observe(value);
    }

    var aw: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer aw.deinit();
    try write(&aw.writer);

    const start = std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_state_cloned_count_bucket",
    ) orelse return error.MissingHistogram;
    try std.testing.expectStringStartsWith(aw.written()[start..],
        \\lodestar_stfn_state_cloned_count_bucket{le="1"} 2
        \\lodestar_stfn_state_cloned_count_bucket{le="2"} 3
        \\lodestar_stfn_state_cloned_count_bucket{le="5"} 5
        \\lodestar_stfn_state_cloned_count_bucket{le="10"} 7
        \\lodestar_stfn_state_cloned_count_bucket{le="50"} 9
        \\lodestar_stfn_state_cloned_count_bucket{le="250"} 11
        \\lodestar_stfn_state_cloned_count_bucket{le="+Inf"} 12
        \\lodestar_stfn_state_cloned_count_sum 640
        \\lodestar_stfn_state_cloned_count_count 12
        \\
    );
}

test "exports inclusive timing histogram buckets" {
    const state_transition = &metrics.state_transition;
    try init(std.testing.allocator, std.testing.io, .{});
    defer deinit();

    for ([_]f64{ 0.5, 1, 3, 4 }) |value| {
        state_transition.epoch_transition.observe(value);
    }
    for ([_]f64{ 0.5, 1, 1.5, 2 }) |value| {
        try state_transition.state_hash_tree_root.observe(.{ .source = .state_transition }, value);
    }

    var aw: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer aw.deinit();
    try write(&aw.writer);

    const scalar_start = std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_epoch_transition_seconds_bucket{le=\"0.5\"}",
    ) orelse return error.MissingHistogram;
    try std.testing.expectStringStartsWith(aw.written()[scalar_start..],
        \\lodestar_stfn_epoch_transition_seconds_bucket{le="0.5"} 1
        \\lodestar_stfn_epoch_transition_seconds_bucket{le="1"} 2
        \\lodestar_stfn_epoch_transition_seconds_bucket{le="3"} 3
        \\lodestar_stfn_epoch_transition_seconds_bucket{le="+Inf"} 4
        \\lodestar_stfn_epoch_transition_seconds_sum 8.5
        \\lodestar_stfn_epoch_transition_seconds_count 4
        \\
    );

    const vector_start = std.mem.find(
        u8,
        aw.written(),
        "lodestar_stfn_hash_tree_root_seconds_bucket{le=\"0.5\",",
    ) orelse return error.MissingHistogram;
    try std.testing.expectStringStartsWith(aw.written()[vector_start..],
        \\lodestar_stfn_hash_tree_root_seconds_bucket{le="0.5",source="state_transition"} 1
        \\lodestar_stfn_hash_tree_root_seconds_bucket{le="1",source="state_transition"} 2
        \\lodestar_stfn_hash_tree_root_seconds_bucket{le="1.5",source="state_transition"} 3
        \\lodestar_stfn_hash_tree_root_seconds_bucket{le="+Inf",source="state_transition"} 4
        \\lodestar_stfn_hash_tree_root_seconds_sum{source="state_transition"} 5
        \\lodestar_stfn_hash_tree_root_seconds_count{source="state_transition"} 4
        \\
    );
}
