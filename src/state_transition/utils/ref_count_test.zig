//! Tests for `ref_count.zig`.

const std = @import("std");
const RefCount = @import("ref_count.zig").RefCount;

test "memory_safety: RefCount.create retains caller ownership on allocation failure" {
    const allocator = std.testing.allocator;
    var list: std.ArrayList(u32) = .empty;
    defer list.deinit(allocator);
    try list.append(allocator, 42);

    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, RefCount(std.ArrayList(u32)).create(failing.allocator(), list));
    try std.testing.expect(failing.has_induced_failure);
    try std.testing.expectEqualSlices(u32, &.{42}, list.items);
    try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
}

test "RefCount - *std.ArrayList(u32)" {
    const allocator = std.testing.allocator;
    const WrappedArrayList = RefCount(*std.ArrayList(u32));

    var array_list: std.ArrayList(u32) = .empty;
    try array_list.append(allocator, 1);
    try array_list.append(allocator, 2);

    // ref_count = 1
    var wrapped_array_list = try WrappedArrayList.create(allocator, &array_list);
    // ref_count = 2
    _ = wrapped_array_list.ref();

    // ref_count = 1
    wrapped_array_list.unref();
    // ref_count = 0 ===> deinit
    wrapped_array_list.unref();

    // the test does not leak any memory because array_list.deinit() is automatically called
}

test "RefCount - std.ArrayList(u32)" {
    const allocator = std.testing.allocator;
    const WrappedArrayList = RefCount(std.ArrayList(u32));

    // ref_count = 1
    var wrapped_array_list = try WrappedArrayList.create(allocator, .empty);
    // ref_count = 2
    _ = wrapped_array_list.ref();

    // ref_count = 1
    wrapped_array_list.unref();
    // ref_count = 0 ===> deinit
    wrapped_array_list.unref();

    // the test does not leak any memory because array_list.deinit() is automatically called
}

test "RefCount - getMutIfUnique" {
    const allocator = std.testing.allocator;
    const rc = try RefCount(std.ArrayList(u32)).create(allocator, .empty);
    defer rc.unref();

    const list = rc.getMutIfUnique() orelse return error.ExpectedUnique;
    try list.append(allocator, 7);
    try std.testing.expectEqualSlices(u32, &.{7}, rc.get().items);

    const other = rc.ref();
    try std.testing.expectEqual(null, rc.getMutIfUnique());

    other.unref();
    try std.testing.expect(rc.getMutIfUnique() != null);
}
