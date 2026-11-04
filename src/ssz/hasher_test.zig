//! Tests for `hasher.zig`.

const std = @import("std");
const FixedContainerType = @import("type/container.zig").FixedContainerType;
const FixedListType = @import("type/list.zig").FixedListType;
const FixedVectorType = @import("type/vector.zig").FixedVectorType;
const UintType = @import("type/uint.zig").UintType;
const Hasher = @import("hasher.zig").Hasher;

test "Hasher should hash ordinary boolean lists as basic lists" {
    const BooleanList = @import("type/list.zig").FixedListType(
        @import("type/bool.zig").BoolType(),
        64,
        .{},
    );
    const allocator = std.testing.allocator;

    var value = BooleanList.default_value;
    defer BooleanList.deinit(allocator, &value);
    try value.appendSlice(allocator, &.{ true, false, true });

    var scratch = try Hasher(BooleanList).init(allocator);
    defer scratch.deinit(allocator);

    var expected: [32]u8 = undefined;
    try BooleanList.hashTreeRoot(allocator, &value, &expected);

    var actual: [32]u8 = undefined;
    try Hasher(BooleanList).hash(&scratch, &value, &actual);

    try std.testing.expectEqual(expected, actual);
}

test "memory_safety: Hasher init container should not leak initialized prefix on later child OOM" {
    const ChildType = FixedVectorType(UintType(64), 8, .{});
    const ContainerType = FixedContainerType(struct {
        first: ChildType,
        second: ChildType,
    });
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            var scratch = try Hasher(ContainerType).init(allocator);
            defer scratch.deinit(allocator);
        }
    }.run, .{});
}

test "memory_safety: Hasher init composite vector should not leak initialized child on parent OOM" {
    const ChildType = FixedVectorType(UintType(64), 8, .{});
    const VectorType = FixedVectorType(ChildType, 2, .{});
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            var scratch = try Hasher(VectorType).init(allocator);
            defer scratch.deinit(allocator);
        }
    }.run, .{});
}

test "memory_safety: Hasher init composite list should not leak children slice on recursive child OOM" {
    const ChildType = FixedVectorType(UintType(64), 8, .{});
    const ListType = FixedListType(ChildType, 4, .{});
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            var scratch = try Hasher(ListType).init(allocator);
            defer scratch.deinit(allocator);
        }
    }.run, .{});
}
