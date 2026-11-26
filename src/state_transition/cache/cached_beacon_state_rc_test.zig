const std = @import("std");
const testing = std.testing;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const CachedBeaconStateRc = @import("cached_beacon_state_rc.zig").CachedBeaconStateRc;

test "CachedBeaconStateRc owns the state allocation until the last release" {
    const allocator = testing.allocator;
    var pool = try Node.Pool.init(.{ .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var helper = try TestCachedBeaconState.init(allocator, &pool, 8);
    defer helper.deinit();

    var state_allocator = testing.FailingAllocator.init(allocator, .{});
    var owner_allocator = testing.FailingAllocator.init(allocator, .{});
    const state = try helper.cached_state.clone(state_allocator.allocator(), .{});
    const owner = CachedBeaconStateRc.create(owner_allocator.allocator(), state) catch |err| {
        state.deinit();
        state_allocator.allocator().destroy(state);
        return err;
    };
    {
        const retained = owner.ref();
        defer retained.unref();
        owner.unref();

        try testing.expectEqual(state, retained.get());
        try testing.expectEqual(try helper.cached_state.state.slot(), try retained.get().state.slot());
        try testing.expect(owner_allocator.allocated_bytes > owner_allocator.freed_bytes);
        try testing.expect(state_allocator.allocated_bytes > state_allocator.freed_bytes);
    }
    try testing.expectEqual(owner_allocator.allocated_bytes, owner_allocator.freed_bytes);
    try testing.expectEqual(state_allocator.allocated_bytes, state_allocator.freed_bytes);
}

test "CachedBeaconStateRc creation failure leaves state ownership with the caller" {
    const allocator = testing.allocator;
    var pool = try Node.Pool.init(.{ .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var helper = try TestCachedBeaconState.init(allocator, &pool, 8);
    defer helper.deinit();

    const state = try helper.cached_state.clone(allocator, .{});
    defer {
        state.deinit();
        allocator.destroy(state);
    }
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try testing.expectError(error.OutOfMemory, CachedBeaconStateRc.create(failing.allocator(), state));
    try testing.expect(failing.has_induced_failure);
    try testing.expectEqual(try helper.cached_state.state.slot(), try state.state.slot());
}
