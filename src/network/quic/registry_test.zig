const std = @import("std");
const Registry = @import("Registry.zig");

fn allocateRegistry(allocator: std.mem.Allocator) !void {
    var registry = try Registry.init(allocator, 4, 42);
    defer registry.deinit(allocator);
}

test "registry cleans every partial startup allocation" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocateRegistry, .{});
}
