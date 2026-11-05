const std = @import("std");
const FaultIo = @import("fault_io.zig");

test "fault providers keep independent counters and forward the base userdata" {
    const Base = struct {
        value: u8,
        calls: usize = 0,

        fn random(userdata: ?*anyopaque, bytes: []u8) void {
            const self: *@This() = @ptrCast(@alignCast(userdata.?));
            self.calls += 1;
            @memset(bytes, self.value);
        }
    };
    var first_base: Base = .{ .value = 17 };
    var second_base: Base = .{ .value = 29 };
    var base_vtable = std.testing.io.vtable.*;
    base_vtable.random = Base.random;
    var first: FaultIo = .{ .base = .{ .userdata = &first_base, .vtable = &base_vtable }, .entropy = .{} };
    var second: FaultIo = .{ .base = .{ .userdata = &second_base, .vtable = &base_vtable }, .entropy = .{ .at = 2 } };

    var bytes: [8]u8 = undefined;
    first.io().random(&bytes);
    try std.testing.expectEqual(@as([8]u8, @splat(17)), bytes);
    second.io().random(&bytes);
    try std.testing.expectEqual(@as([8]u8, @splat(29)), bytes);
    try std.testing.expectEqual(@as(usize, 1), first_base.calls);
    try std.testing.expectEqual(@as(usize, 1), second_base.calls);
    try std.testing.expectError(error.EntropyUnavailable, first.io().randomSecure(&bytes));
    try std.testing.expectEqual(@as(usize, 1), first.entropy_calls);
    try std.testing.expectEqual(@as(usize, 0), second.entropy_calls);
}

test "fault providers compose without replacing another fixture's context" {
    var inner: FaultIo = .{ .entropy = .{ .at = 2 } };
    var outer: FaultIo = .{ .base = inner.io() };
    var bytes: [8]u8 = undefined;
    try outer.io().randomSecure(&bytes);
    try std.testing.expectError(error.EntropyUnavailable, outer.io().randomSecure(&bytes));
    try std.testing.expectEqual(@as(usize, 2), outer.entropy_calls);
    try std.testing.expectEqual(@as(usize, 2), inner.entropy_calls);
}

test "a fault provider follows its Io when used on another thread" {
    const Worker = struct {
        result: std.Io.RandomSecureError!void = {},

        fn run(self: *@This(), io: std.Io) void {
            var bytes: [8]u8 = undefined;
            self.result = io.randomSecure(&bytes);
        }
    };
    var faults: FaultIo = .{ .entropy = .{} };
    var worker: Worker = .{};
    const thread = try std.Thread.spawn(.{}, Worker.run, .{ &worker, faults.io() });
    thread.join();
    try std.testing.expectError(error.EntropyUnavailable, worker.result);
    var bytes: [8]u8 = undefined;
    try std.testing.expectError(error.EntropyUnavailable, faults.io().randomSecure(&bytes));
    try std.testing.expectEqual(@as(usize, 2), faults.entropy_calls);
}
