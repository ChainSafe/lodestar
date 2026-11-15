//! Tests for `bounded_array.zig`.

const std = @import("std");
const testing = std.testing;
const BoundedArray = @import("bounded_array.zig").BoundedArray;

test "default-constructed is empty" {
    const A = BoundedArray(u32, 4);
    var a: A = .{};
    try testing.expect(a.empty());
    try testing.expect(!a.full());
    try testing.expectEqual(@as(u32, 0), a.count);
    try testing.expectEqual(@as(u32, 4), A.capacity);
    try testing.expectEqual(@as(usize, 0), a.slice().len);
}

test "push fills up to capacity" {
    var a: BoundedArray(u32, 3) = .{};
    a.push(10);
    a.push(20);
    a.push(30);
    try testing.expect(a.full());
    try testing.expectEqualSlices(u32, &.{ 10, 20, 30 }, a.slice());
}

test "pop returns elements in LIFO order" {
    var a: BoundedArray(u32, 3) = .{};
    a.push(10);
    a.push(20);
    try testing.expectEqual(@as(?u32, 20), a.pop());
    try testing.expectEqual(@as(?u32, 10), a.pop());
    try testing.expectEqual(@as(?u32, null), a.pop());
}

test "orderedRemove shifts trailing elements down" {
    var a: BoundedArray(u32, 4) = .{};
    a.push(1);
    a.push(2);
    a.push(3);
    a.push(4);
    a.orderedRemove(1);
    try testing.expectEqualSlices(u32, &.{ 1, 3, 4 }, a.slice());
    a.orderedRemove(0);
    try testing.expectEqualSlices(u32, &.{ 3, 4 }, a.slice());
    a.orderedRemove(1);
    try testing.expectEqualSlices(u32, &.{3}, a.slice());
}

test "clear resets count without touching buffer" {
    var a: BoundedArray(u32, 3) = .{};
    a.push(1);
    a.push(2);
    a.clear();
    try testing.expect(a.empty());
    try testing.expectEqualSlices(u32, &.{}, a.slice());
}

test "slice allows in-place mutation" {
    var a: BoundedArray(u32, 3) = .{};
    a.push(1);
    a.push(2);
    a.push(3);
    for (a.slice()) |*x| x.* *= 10;
    try testing.expectEqualSlices(u32, &.{ 10, 20, 30 }, a.constSlice());
}

test "constSlice from const receiver returns read-only view" {
    var a: BoundedArray(u32, 3) = .{};
    a.push(1);
    a.push(2);
    const ptr: *const BoundedArray(u32, 3) = &a;
    const view = ptr.constSlice();
    try testing.expectEqual(@as(usize, 2), view.len);
    try testing.expectEqualSlices(u32, &.{ 1, 2 }, view);
}

test "struct payload" {
    const Entry = struct { id: u64, value: i32 };
    var a: BoundedArray(Entry, 2) = .{};
    a.push(.{ .id = 1, .value = -5 });
    a.push(.{ .id = 2, .value = 7 });
    try testing.expectEqual(@as(u64, 1), a.slice()[0].id);
    try testing.expectEqual(@as(i32, 7), a.slice()[1].value);
}

test "comptime construction" {
    const a = comptime blk: {
        var arr: BoundedArray(u32, 3) = .{};
        arr.push(1);
        arr.push(2);
        break :blk arr;
    };
    try testing.expectEqual(@as(u32, 2), a.count);
    try testing.expectEqualSlices(u32, &.{ 1, 2 }, a.constSlice());
}
