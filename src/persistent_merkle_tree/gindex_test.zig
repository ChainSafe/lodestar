//! Tests for `gindex.zig`.

const std = @import("std");
const GindexUint = @import("hashing").GindexUint;
const max_depth = @import("hashing").max_depth;
const Gindex = @import("gindex.zig").Gindex;

test {
    var bits: [max_depth]u1 = undefined;

    const a: Gindex = @enumFromInt(9);
    try std.testing.expectEqualSlices(u1, &[_]u1{ 0, 0, 1 }, a.toPathBits(&bits));
    try std.testing.expectEqual(@as(Gindex.Path, @enumFromInt(4)), a.toPath());

    const b: Gindex = @enumFromInt(10);
    try std.testing.expectEqualSlices(u1, &[_]u1{ 0, 1, 0 }, b.toPathBits(&bits));
    try std.testing.expectEqual(@as(Gindex.Path, @enumFromInt(2)), b.toPath());
}

test "concat gindices" {
    // [2, 3] -> 5
    const case1: []const Gindex = &.{ Gindex.fromUint(2), Gindex.fromUint(3) };
    try std.testing.expectEqual(@as(GindexUint, 5), @intFromEnum(Gindex.concat(case1)));

    // [31, 3] -> 63
    const case2: []const Gindex = &.{ Gindex.fromUint(31), Gindex.fromUint(3) };
    try std.testing.expectEqual(@as(GindexUint, 63), @intFromEnum(Gindex.concat(case2)));

    // [31, 6] -> 126
    const case3: []const Gindex = &.{ Gindex.fromUint(31), Gindex.fromUint(6) };
    try std.testing.expectEqual(@as(GindexUint, 126), @intFromEnum(Gindex.concat(case3)));

    const empty: []const Gindex = &.{};
    try std.testing.expectEqual(@as(GindexUint, 1), @intFromEnum(Gindex.concat(empty)));

    const single: []const Gindex = &.{Gindex.fromUint(42)};
    try std.testing.expectEqual(@as(GindexUint, 42), @intFromEnum(Gindex.concat(single)));

    // [1, 5] -> 5
    const with_root: []const Gindex = &.{ Gindex.fromUint(1), Gindex.fromUint(5) };
    try std.testing.expectEqual(@as(GindexUint, 5), @intFromEnum(Gindex.concat(with_root)));

    // [5, 1] -> 5
    const root_suffix: []const Gindex = &.{ Gindex.fromUint(5), Gindex.fromUint(1) };
    try std.testing.expectEqual(@as(GindexUint, 5), @intFromEnum(Gindex.concat(root_suffix)));

    // [2, 2, 2] -> 8 (going left 3 times from root)
    const three_lefts: []const Gindex = &.{ Gindex.fromUint(2), Gindex.fromUint(2), Gindex.fromUint(2) };
    try std.testing.expectEqual(@as(GindexUint, 8), @intFromEnum(Gindex.concat(three_lefts)));

    // [3, 3, 3] -> 15 (going right 3 times from root)
    // concat(3, 3) = 7, concat(7, 3) = 15
    const three_rights: []const Gindex = &.{ Gindex.fromUint(3), Gindex.fromUint(3), Gindex.fromUint(3) };
    try std.testing.expectEqual(@as(GindexUint, 15), @intFromEnum(Gindex.concat(three_rights)));
}
