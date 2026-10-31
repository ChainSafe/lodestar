const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const BeaconState = @import("beacon_state.zig").BeaconState;

const pool_size = 500_000;
const participation = [_]u8{ 1, 2, 4 };

fn initParticipationState(allocator: std.mem.Allocator, pool: *Node.Pool) !BeaconState(.altair) {
    var state: BeaconState(.altair) = .{
        .inner = try ct.altair.BeaconState.TreeView.fromValue(allocator, pool, &ct.altair.BeaconState.default_value),
    };
    errdefer state.deinit();

    const current = try state.currentEpochParticipation();
    for (participation) |flags| try current.push(flags);
    try state.commit();
    return state;
}

fn expectPreviousParticipation(state: *BeaconState(.altair)) !void {
    const previous = try state.previousEpochParticipation();
    try std.testing.expectEqual(participation.len, try previous.length());
    for (participation, 0..) |flags, index| {
        try std.testing.expectEqual(flags, try previous.get(index));
    }
}

test "rotateEpochParticipation preserves transferred view after pool exhaustion" {
    const allocator = std.testing.allocator;
    for (0..2) |remaining_slots| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
        defer pool.deinit();
        const initial_nodes = pool.getNodesInUse();

        {
            var state = try initParticipationState(allocator, &pool);
            defer state.deinit();

            const filler = try allocator.alloc(Node.Id, pool_size);
            defer allocator.free(filler);
            var filler_count: usize = 0;
            defer pool.free(filler[0..filler_count]);
            while (filler_count < filler.len) : (filler_count += 1) {
                filler[filler_count] = pool.createLeafFromUint(0) catch |err| switch (err) {
                    error.PoolExhausted => break,
                };
            }
            try std.testing.expectEqual(pool.nodes.len, @as(usize, @intFromEnum(pool.next_free_node)));
            for (0..remaining_slots) |_| {
                filler_count -= 1;
                pool.unref(filler[filler_count]);
            }
            const nodes_before = pool.getNodesInUse();

            try std.testing.expectError(error.PoolExhausted, state.rotateEpochParticipation());
            try std.testing.expectEqual(nodes_before, pool.getNodesInUse());
            try expectPreviousParticipation(&state);
        }

        try std.testing.expectEqual(initial_nodes, pool.getNodesInUse());
    }
}

test "memory_safety: rotateEpochParticipation preserves ownership across allocation failures" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(failing_allocator: std.mem.Allocator, node_pool: *Node.Pool) !void {
            const initial_nodes = node_pool.getNodesInUse();
            defer std.debug.assert(node_pool.getNodesInUse() == initial_nodes);

            var state = try initParticipationState(failing_allocator, node_pool);
            defer state.deinit();

            const previous_root = (try state.inner.getFieldRoot("previous_epoch_participation")).*;
            const current_root = (try state.inner.getFieldRoot("current_epoch_participation")).*;
            state.rotateEpochParticipation() catch |err| {
                try std.testing.expectEqualSlices(u8, &current_root, try state.inner.getFieldRoot("current_epoch_participation"));
                const previous_after = try state.inner.getFieldRoot("previous_epoch_participation");
                try std.testing.expect(std.mem.eql(u8, &previous_root, previous_after) or
                    std.mem.eql(u8, &current_root, previous_after));
                return err;
            };
            try expectPreviousParticipation(&state);
        }
    }.run, .{&pool});
}

test "rotateEpochParticipation moves flags and resets current participation" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var state = try initParticipationState(allocator, &pool);
    defer state.deinit();

    try state.rotateEpochParticipation();
    try state.commit();
    try expectPreviousParticipation(&state);

    const current = try state.currentEpochParticipation();
    try std.testing.expectEqual(participation.len, try current.length());
    for (0..participation.len) |index| {
        try std.testing.expectEqual(@as(u8, 0), try current.get(index));
    }
}
